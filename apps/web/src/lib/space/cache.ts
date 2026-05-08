/**
 * SQLite cache for the `Space` index, at `<spaceRoot>/.amber/cache.db`.
 *
 * The cache is *strictly regenerable*: it stores nothing the filesystem
 * doesn't, and deleting it at any time is safe — the next cold start rebuilds
 * it. The filesystem is the source of truth; the cache is an optimization.
 *
 * Hydration validity is decided by mtime alone: if every cached page row's
 * mtime matches its file on disk, and the manifest's mtime matches, and the
 * set of files matches, the cache is good. Any mismatch falls through to the
 * pure `load()`.
 */

import { Database } from 'bun:sqlite';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { readManifest, resolveNav, normalizeUrl } from './load.ts';
import { logger } from '$lib/server/logger';
import {
	RESERVED_TOP_LEVEL,
	isReservedPath,
	type AmberManifest,
	type LoadWarning,
	type Page,
	type Space
} from '$lib/types/schema';

const log = logger.child({ subsystem: 'cache' });

const SCHEMA_VERSION = '2';

export class SpaceCache {
	private db: Database;
	private readonly dbPath: string;

	constructor(spaceRoot: string) {
		const dir = join(spaceRoot, '.amber');
		this.dbPath = join(dir, 'cache.db');
		mkdirSync(dir, { recursive: true });
		this.db = new Database(this.dbPath, { create: true });
		this.db.exec('PRAGMA journal_mode = WAL');
		this.ensureSchema();
	}

	close(): void {
		try {
			this.db.close();
		} catch {
			// already closed; ignore
		}
	}

	private ensureSchema(): void {
		this.db.exec(`
			CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS pages (
				rel TEXT PRIMARY KEY,
				url TEXT NOT NULL,
				frontmatter TEXT NOT NULL,
				extra TEXT NOT NULL,
				body TEXT NOT NULL,
				mtime REAL NOT NULL,
				content_hash TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS warnings (
				code TEXT NOT NULL,
				source TEXT,
				message TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS renders (
				content_hash TEXT PRIMARY KEY,
				html TEXT NOT NULL,
				created_at INTEGER NOT NULL
			);
		`);
		const stored = this.getMeta('schema_version');
		if (stored == null) {
			this.setMeta('schema_version', SCHEMA_VERSION);
		} else if (stored !== SCHEMA_VERSION) {
			// Silently wipe — the cache is regenerable, so an old schema is
			// not a data-loss event.
			this.db.exec(
				'DELETE FROM meta; DELETE FROM pages; DELETE FROM warnings; DELETE FROM renders'
			);
			this.setMeta('schema_version', SCHEMA_VERSION);
		}
	}

	private getMeta(key: string): string | null {
		const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as {
			value: string;
		} | null;
		return row ? row.value : null;
	}

	private setMeta(key: string, value: string): void {
		this.db
			.prepare(
				'INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
			)
			.run(key, value);
	}

	/**
	 * Try to hydrate a Space from cache. Returns null if the cache is stale
	 * or absent; the caller falls through to a fresh `load()`.
	 *
	 * "Stale" is defined narrowly: any of (a) schema mismatch handled in
	 * `ensureSchema`, (b) `amber.toml` mtime drift, (c) any FS file with
	 * differing mtime, (d) any FS file missing from cache or vice versa.
	 */
	tryHydrate(spaceRoot: string): { space: Space; warnings: LoadWarning[] } | null {
		const manifestPath = join(spaceRoot, 'amber.toml');
		if (!existsSync(manifestPath)) return null;

		const manifestStat = statSync(manifestPath);
		const cachedManifestMtime = this.getMeta('manifest_mtime');
		if (cachedManifestMtime == null) return null;
		if (Number(cachedManifestMtime) !== manifestStat.mtimeMs) return null;

		// Walk content like the loader does, collecting (rel, mtime, filePath).
		const fsFiles = walkContentFiles(spaceRoot);

		// Pull all cached page rows.
		const rows = this.db
			.prepare('SELECT rel, url, frontmatter, extra, body, mtime, content_hash FROM pages')
			.all() as PageRow[];

		if (rows.length !== fsFiles.size) return null;

		const pages = new Map<string, Page>();
		const pagesByRel = new Map<string, Page>();
		for (const row of rows) {
			const fsEntry = fsFiles.get(row.rel);
			if (!fsEntry) return null;
			if (fsEntry.mtime !== row.mtime) return null;
			const page = rowToPage(row, fsEntry.filePath);
			// Defensive: a duplicate URL in the cache would contradict the
			// "first wins" rule we kept on disk; treat that as a stale
			// cache rather than silently shadowing.
			if (pages.has(page.url)) return null;
			pages.set(page.url, page);
			pagesByRel.set(page.relativePath, page);
		}

		// Manifest: re-read from disk (cheap, and avoids round-tripping TOML
		// through JSON). The mtime check above already proved it hasn't moved.
		let manifest: AmberManifest;
		try {
			manifest = readManifest(spaceRoot);
		} catch {
			return null;
		}

		// Re-resolve nav and redirects from the parsed manifest + cached pages.
		// Nav warnings are recomputed live; only per-page warnings come out of
		// the cache.
		const navWarnings: LoadWarning[] = [];
		const nav = manifest.nav ? resolveNav(manifest.nav, pagesByRel, navWarnings) : [];
		const redirects = new Map<string, string>();
		if (manifest.redirects) {
			for (const [from, to] of Object.entries(manifest.redirects)) {
				redirects.set(normalizeUrl(from), normalizeUrl(to));
			}
		}

		const cachedWarnings = this.db
			.prepare('SELECT code, source, message FROM warnings')
			.all() as Array<{ code: string; source: string | null; message: string }>;
		const pageWarnings: LoadWarning[] = cachedWarnings.map((r) => ({
			code: r.code as LoadWarning['code'],
			source: r.source ?? undefined,
			message: r.message
		}));

		const warnings = [...pageWarnings, ...navWarnings];

		const space: Space = {
			root: spaceRoot,
			manifest,
			pages,
			nav,
			redirects,
			warnings
		};
		return { space, warnings };
	}

	/**
	 * Replace cache contents with the current Space state. Used after a cold
	 * load fell through to `load()`, and also as the "rewrite-all" path when
	 * we don't know what changed (cheap because Spaces are small).
	 */
	writeAll(space: Space): void {
		const tx = this.db.transaction(() => {
			this.db.exec('DELETE FROM pages; DELETE FROM warnings');
			const insertPage = this.db.prepare(
				'INSERT INTO pages(rel, url, frontmatter, extra, body, mtime, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
			);
			for (const page of space.pages.values()) {
				insertPage.run(
					page.relativePath,
					page.url,
					JSON.stringify(page.frontmatter),
					JSON.stringify(page.extra),
					page.body,
					page.mtime,
					page.contentHash
				);
			}
			const insertWarning = this.db.prepare(
				'INSERT INTO warnings(code, source, message) VALUES (?, ?, ?)'
			);
			for (const w of space.warnings) {
				// Nav warnings are recomputed on hydrate; persisting only the
				// per-page warnings keeps the cache decoupled from manifest
				// drift.
				if (w.code === 'frontmatter_parse_error' || w.code === 'duplicate_url') {
					insertWarning.run(w.code, w.source ?? null, w.message);
				}
			}
			const manifestMtime = statSync(join(space.root, 'amber.toml')).mtimeMs;
			this.setMeta('manifest_mtime', String(manifestMtime));
		});
		try {
			tx();
		} catch (err) {
			// Cache write failures must not take down the running process —
			// the in-memory index is still the truth.
			log.warn({ err }, 'cache write failed');
		}
	}

	/** Upsert a single page row. Used by `apply()` for add/change events. */
	upsertPage(page: Page): void {
		try {
			this.db
				.prepare(
					'INSERT INTO pages(rel, url, frontmatter, extra, body, mtime, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?) ' +
						'ON CONFLICT(rel) DO UPDATE SET url=excluded.url, frontmatter=excluded.frontmatter, extra=excluded.extra, body=excluded.body, mtime=excluded.mtime, content_hash=excluded.content_hash'
				)
				.run(
					page.relativePath,
					page.url,
					JSON.stringify(page.frontmatter),
					JSON.stringify(page.extra),
					page.body,
					page.mtime,
					page.contentHash
				);
		} catch (err) {
			log.warn({ err }, 'cache upsertPage failed');
		}
	}

	/** Delete a page row by relative path. Used by `apply()` for unlink. */
	deletePage(rel: string): void {
		try {
			this.db.prepare('DELETE FROM pages WHERE rel = ?').run(rel);
		} catch (err) {
			log.warn({ err }, 'cache deletePage failed');
		}
	}

	/**
	 * Replace the persisted per-page warnings (frontmatter_parse_error,
	 * duplicate_url) with the supplied set. Nav-derived warnings stay in
	 * memory and aren't persisted.
	 */
	replacePageWarnings(warnings: LoadWarning[]): void {
		try {
			const tx = this.db.transaction(() => {
				this.db.exec('DELETE FROM warnings');
				const stmt = this.db.prepare(
					'INSERT INTO warnings(code, source, message) VALUES (?, ?, ?)'
				);
				for (const w of warnings) {
					if (w.code === 'frontmatter_parse_error' || w.code === 'duplicate_url') {
						stmt.run(w.code, w.source ?? null, w.message);
					}
				}
			});
			tx();
		} catch (err) {
			log.warn({ err }, 'cache replacePageWarnings failed');
		}
	}

	/**
	 * Look up a cached render by content hash. Returns the HTML string, or
	 * null if no row exists. The hash is sha256 of the page body alone, not
	 * the full file (frontmatter is excluded so two pages with identical
	 * bodies share a row).
	 */
	getRender(contentHash: string): string | null {
		try {
			const row = this.db
				.prepare('SELECT html FROM renders WHERE content_hash = ?')
				.get(contentHash) as { html: string } | null;
			return row ? row.html : null;
		} catch (err) {
			log.warn({ err }, 'cache getRender failed');
			return null;
		}
	}

	/**
	 * Persist a rendered HTML string under its content hash. No-ops on the
	 * conflict — identical hash means identical body means identical HTML.
	 *
	 * Eviction is intentionally unimplemented: orphaned rows (left after a
	 * page body changes) are cheap, and a vacuum step can land later. See
	 * `lib/render/README.md`.
	 */
	putRender(contentHash: string, html: string): void {
		try {
			this.db
				.prepare(
					'INSERT INTO renders(content_hash, html, created_at) VALUES (?, ?, ?) ' +
						'ON CONFLICT(content_hash) DO NOTHING'
				)
				.run(contentHash, html, Date.now());
		} catch (err) {
			log.warn({ err }, 'cache putRender failed');
		}
	}

	/** Update the cached manifest mtime after a manifest_change event. */
	updateManifestMtime(spaceRoot: string): void {
		try {
			const mtime = statSync(join(spaceRoot, 'amber.toml')).mtimeMs;
			this.setMeta('manifest_mtime', String(mtime));
		} catch (err) {
			log.warn({ err }, 'cache updateManifestMtime failed');
		}
	}
}

interface PageRow {
	rel: string;
	url: string;
	frontmatter: string;
	extra: string;
	body: string;
	mtime: number;
	content_hash: string;
}

function rowToPage(row: PageRow, filePath: string): Page {
	return {
		filePath,
		relativePath: row.rel,
		url: row.url,
		frontmatter: JSON.parse(row.frontmatter),
		extra: JSON.parse(row.extra),
		body: row.body,
		mtime: row.mtime,
		contentHash: row.content_hash
	};
}

/**
 * Walk the content tree the same way the loader does and return a map of
 * relative-path → { mtime, filePath }. Reserved names are excluded with the
 * loader's exact rules.
 */
function walkContentFiles(root: string): Map<string, { mtime: number; filePath: string }> {
	const out = new Map<string, { mtime: number; filePath: string }>();
	walk(root, root, out);
	return out;
}

function walk(
	root: string,
	dir: string,
	out: Map<string, { mtime: number; filePath: string }>
): void {
	const isTopLevel = dir === root;
	let entries: import('node:fs').Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const entry of entries) {
		const name = entry.name;
		if (isTopLevel) {
			if (isReservedPath(name)) continue;
		} else {
			if (name.startsWith('_') || name.startsWith('.')) continue;
			if (RESERVED_TOP_LEVEL.has(name) && name !== 'themes') continue;
		}
		const full = join(dir, name);
		if (entry.isDirectory()) {
			walk(root, full, out);
		} else if (entry.isFile() && name.toLowerCase().endsWith('.md')) {
			const stat = statSync(full);
			const rel = relativePosix(root, full);
			out.set(rel, { mtime: stat.mtimeMs, filePath: full });
		}
	}
}

function relativePosix(root: string, full: string): string {
	const rel =
		full.startsWith(root + '/') || full.startsWith(root + '\\')
			? full.slice(root.length + 1)
			: full;
	return rel.split(/[\\/]/).join('/');
}
