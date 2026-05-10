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
import { existsSync, mkdirSync, readdirSync, statSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import {
	readManifest,
	resolveNav,
	normalizeUrl,
	mergeFrontmatterRedirects
} from './load.ts';
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

const SCHEMA_VERSION = '3';

/**
 * Hash of a page body alone (sha256, hex). Mirrors `bodyHash` in
 * `$lib/render/cache` — duplicated here to avoid a circular import chain
 * (`render/cache` imports `space/space` which imports `space/cache`). Both
 * call sites must produce the same digest for the same input; if one drifts,
 * rename detection breaks silently. Same algorithm, same encoding, no
 * normalization beyond what `buildPage` already does to the file body.
 */
function bodyHash(body: string): string {
	return createHash('sha256').update(body).digest('hex');
}

export class SpaceCache {
	private db: Database;
	private readonly dbPath: string;

	constructor(spaceRoot: string) {
		const dir = join(spaceRoot, '.amber');
		this.dbPath = join(dir, 'cache.db');
		mkdirSync(dir, { recursive: true });
		this.db = this.openWithRecovery();
	}

	/**
	 * Open the SQLite database, recovering from on-disk corruption.
	 *
	 * A `cache.db` file that isn't a valid SQLite database (e.g. truncated by
	 * a crash, or replaced with junk content) will fail at open time, on the
	 * `PRAGMA journal_mode = WAL` write, or inside `ensureSchema()` — depending
	 * on how broken it is. The cache is regenerable by definition (filesystem
	 * is truth), so any of those failures is treated identically: log a
	 * warning, wipe the on-disk file plus its WAL/SHM siblings, and retry the
	 * open exactly once. A second failure is a real bug and is rethrown.
	 *
	 * Recovery is scoped narrowly to SQLite-level errors during open/schema.
	 * Anything else (e.g. an `mkdirSync` EACCES) propagates unchanged.
	 */
	private openWithRecovery(): Database {
		try {
			const db = new Database(this.dbPath, { create: true });
			db.exec('PRAGMA journal_mode = WAL');
			this.db = db;
			this.ensureSchema();
			return db;
		} catch (err) {
			log.warn({ err, dbPath: this.dbPath }, 'cache corrupt, rebuilding');
			this.wipeDbFiles();
			const db = new Database(this.dbPath, { create: true });
			db.exec('PRAGMA journal_mode = WAL');
			this.db = db;
			this.ensureSchema();
			return db;
		}
	}

	private wipeDbFiles(): void {
		for (const path of [this.dbPath, this.dbPath + '-wal', this.dbPath + '-shm']) {
			try {
				unlinkSync(path);
			} catch {
				// File may not exist (especially the WAL/SHM siblings); ignore.
			}
		}
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
			-- Snapshot of the previous load's page identities, used to detect
			-- body-hash-stable renames between loads. Rewritten wholesale on
			-- every cold-load writeAll.
			CREATE TABLE IF NOT EXISTS page_snapshot (
				rel TEXT PRIMARY KEY,
				url TEXT NOT NULL,
				body_hash TEXT NOT NULL
			);
			-- Persisted auto-rename redirects. The cache is the persistence
			-- layer for these because the filesystem alone can't reconstruct
			-- "what was this URL last time?". Accumulates across loads; entries
			-- are evicted only when a real page reclaims the source URL.
			CREATE TABLE IF NOT EXISTS auto_redirects (
				from_url TEXT PRIMARY KEY,
				to_url TEXT NOT NULL
			);
		`);
		const stored = this.getMeta('schema_version');
		if (stored == null) {
			this.setMeta('schema_version', SCHEMA_VERSION);
		} else if (stored !== SCHEMA_VERSION) {
			// Silently wipe — the cache is regenerable, so an old schema is
			// not a data-loss event.
			this.db.exec(
				'DELETE FROM meta; DELETE FROM pages; DELETE FROM warnings; DELETE FROM renders; DELETE FROM page_snapshot; DELETE FROM auto_redirects'
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
		}

		// Manifest: re-read from disk (cheap, and avoids round-tripping TOML
		// through JSON). The mtime check above already proved it hasn't moved.
		let manifest: AmberManifest;
		try {
			manifest = readManifest(spaceRoot);
		} catch {
			return null;
		}

		// Re-validate nav from the parsed manifest. v0.2 nav is `{ label, href }` —
		// no resolution against the page index, no warnings emitted; malformed
		// entries are logged inside resolveNav. Only per-page warnings come out
		// of the cache.
		const nav = manifest.nav ? resolveNav(manifest.nav) : [];
		const redirects = new Map<string, string>();
		if (manifest.redirects) {
			for (const [from, to] of Object.entries(manifest.redirects)) {
				redirects.set(normalizeUrl(from), normalizeUrl(to));
			}
		}
		// Order must mirror the cold path in `Space.load`: manifest +
		// frontmatter are explicit author intent and beat the body-hash
		// inference, so auto-renames only fill the gaps.
		//
		//   Effective precedence: frontmatter > manifest > auto-rename
		//
		// Skip an auto-rename row when (a) a real page now lives at the
		// source URL — the live page always wins — or (b) the source is
		// already claimed by manifest `[redirects]`. Frontmatter merges
		// after, so frontmatter still overrides auto-rename either way.
		for (const row of this.db
			.prepare('SELECT from_url, to_url FROM auto_redirects')
			.all() as Array<{ from_url: string; to_url: string }>) {
			if (pages.has(row.from_url)) continue;
			if (redirects.has(row.from_url)) continue;
			redirects.set(row.from_url, row.to_url);
		}
		mergeFrontmatterRedirects(pages, redirects, 'manifest+auto-rename');

		const cachedWarnings = this.db
			.prepare('SELECT code, source, message FROM warnings')
			.all() as Array<{ code: string; source: string | null; message: string }>;
		const pageWarnings: LoadWarning[] = cachedWarnings.map((r) => ({
			code: r.code as LoadWarning['code'],
			source: r.source ?? undefined,
			message: r.message
		}));

		const warnings = pageWarnings;

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
	 *
	 * Side effect: detects body-hash-stable renames against the previous
	 * snapshot (see `detectAutoRenames` for the heuristic) and persists them
	 * to `auto_redirects`. Returns the freshly inserted pairs (the union of
	 * pre-existing rows and just-detected renames, minus any whose source URL
	 * is reclaimed by a current page) so the caller can merge them into the
	 * live `Space.redirects` without re-querying the database.
	 *
	 * Body hashes are already computed for every Page (via `bodyHash` on
	 * `page.body`) — filesystem is truth, body hashes are already cheap, no
	 * new author burden, no git dependency. Frontmatter changes don't break
	 * the heuristic because the hash is body-only.
	 */
	writeAll(space: Space): Map<string, string> {
		const newAutoRedirects = new Map<string, string>();
		const tx = this.db.transaction(() => {
			// Snapshot-based rename detection runs *before* we overwrite the
			// pages table. The cache is the persistence layer for auto-rename
			// redirects: filesystem alone can't tell us "this URL existed
			// last time and points at the same body that lives elsewhere now."
			const prior = this.db
				.prepare('SELECT rel, url, body_hash FROM page_snapshot')
				.all() as Array<{ rel: string; url: string; body_hash: string }>;
			const detected = detectAutoRenames(prior, space.pages);

			this.db.exec('DELETE FROM pages; DELETE FROM warnings; DELETE FROM page_snapshot');
			const insertPage = this.db.prepare(
				'INSERT INTO pages(rel, url, frontmatter, extra, body, mtime, content_hash) VALUES (?, ?, ?, ?, ?, ?, ?)'
			);
			const insertSnapshot = this.db.prepare(
				'INSERT INTO page_snapshot(rel, url, body_hash) VALUES (?, ?, ?)'
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
				insertSnapshot.run(page.relativePath, page.url, bodyHash(page.body));
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

			// Upsert detected renames into auto_redirects.
			const upsertAuto = this.db.prepare(
				'INSERT INTO auto_redirects(from_url, to_url) VALUES (?, ?) ' +
					'ON CONFLICT(from_url) DO UPDATE SET to_url = excluded.to_url'
			);
			for (const [from, to] of detected) {
				upsertAuto.run(from, to);
			}
			// Evict any auto_redirects whose source URL is now claimed by a
			// real page (the live page wins). Run after the upsert so a brand-
			// new rename pointing at a URL that happens to also be a live page
			// is treated consistently with old rows.
			const deleteClaimed = this.db.prepare('DELETE FROM auto_redirects WHERE from_url = ?');
			for (const url of space.pages.keys()) {
				deleteClaimed.run(url);
			}

			// Snapshot the surviving auto_redirects so the caller can merge
			// them into the live Space.redirects map without a second query.
			for (const row of this.db
				.prepare('SELECT from_url, to_url FROM auto_redirects')
				.all() as Array<{ from_url: string; to_url: string }>) {
				newAutoRedirects.set(row.from_url, row.to_url);
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
		return newAutoRedirects;
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

	/**
	 * Delete every row from `renders` whose `content_hash` is not in
	 * `activeHashes`. Returns the number of rows deleted.
	 *
	 * Vacuum is opportunistic cleanup, not invalidation: the filesystem
	 * is still the source of truth, and dropping orphaned render rows
	 * cannot lose user data. Renders are bounded by the number of
	 * distinct page bodies, so a row-by-row scan inside a transaction is
	 * fine.
	 */
	vacuum(activeHashes: Set<string>): number {
		try {
			const rows = this.db.prepare('SELECT content_hash FROM renders').all() as Array<{
				content_hash: string;
			}>;
			const orphans = rows
				.map((r) => r.content_hash)
				.filter((h) => !activeHashes.has(h));
			if (orphans.length === 0) return 0;
			let deleted = 0;
			const stmt = this.db.prepare('DELETE FROM renders WHERE content_hash = ?');
			const tx = this.db.transaction(() => {
				for (const h of orphans) {
					const result = stmt.run(h);
					deleted += Number(result.changes ?? 0);
				}
			});
			tx();
			return deleted;
		} catch (err) {
			log.warn({ err }, 'cache vacuum failed');
			return 0;
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

/**
 * Compare a previous load's snapshot to the current page set. A previous page
 * (rel A, url U_A, body_hash H) that no longer exists, paired with a current
 * page sharing body_hash H but at a different rel/url, is treated as a rename:
 * `U_A → current_url` becomes an auto-redirect.
 *
 * Decision rationale (documented on the inference site): body hashes are
 * already computed for the render cache, the filesystem is truth, this adds
 * no author burden and has no git dependency.
 *
 * Edge cases:
 *   - Multiple current pages share the body hash with a disappeared one →
 *     ambiguous. Skip the redirect for that hash and log the candidates.
 *   - The previous URL is still live (a real page exists at U_A) → not a
 *     rename, just an unrelated edit elsewhere; skipped.
 *   - The matched current page's URL is the same as the previous URL → not a
 *     rename; skipped.
 */
function detectAutoRenames(
	prior: Array<{ rel: string; url: string; body_hash: string }>,
	current: Map<string, Page>
): Map<string, string> {
	const out = new Map<string, string>();

	// Index current pages by body_hash and by rel so we can cheaply ask
	// "what bodies match?" and "is this rel still live?".
	const currentByRel = new Map<string, Page>();
	const currentByHash = new Map<string, Page[]>();
	for (const page of current.values()) {
		currentByRel.set(page.relativePath, page);
		const h = bodyHash(page.body);
		const list = currentByHash.get(h);
		if (list) list.push(page);
		else currentByHash.set(h, [page]);
	}

	for (const snap of prior) {
		// If the previous rel is still live, the page didn't disappear; not a
		// rename.
		if (currentByRel.has(snap.rel)) continue;

		// If a real page still occupies the previous URL, we don't want to
		// shadow it with a redirect.
		if (current.has(snap.url)) continue;

		const candidates = currentByHash.get(snap.body_hash);
		if (!candidates || candidates.length === 0) continue;

		if (candidates.length > 1) {
			log.info(
				{
					from_url: snap.url,
					body_hash: snap.body_hash,
					candidates: candidates.map((p) => p.relativePath)
				},
				`auto-rename ambiguous: previous ${snap.rel} (${snap.url}) matches multiple current pages by body hash; skipping`
			);
			continue;
		}

		const target = candidates[0];
		// A current page with the same rel as the snapshot can't reach here
		// (filtered above), but the rel may have been reused after a
		// content-stable rename — guard against pointing a URL at itself.
		if (target.url === snap.url) continue;
		out.set(snap.url, target.url);
	}

	return out;
}
