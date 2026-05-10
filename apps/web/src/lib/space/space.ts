/**
 * `Space` — owns the in-memory index of an Amber space and applies
 * incremental filesystem changes via `apply(event)`.
 *
 * The pure `load()` from `./load.ts` remains the cold-start path; this class
 * wraps it, takes ownership of the resulting data, and mutates it in place as
 * events arrive. Cache and watcher land in subsequent layers; this file is
 * deliberately ignorant of both.
 *
 * Apply contract:
 *   - Mutates the in-memory index in place. Consumers holding references to
 *     `space.pages`, `space.nav`, `space.warnings` see updates immediately.
 *   - Returns the *newly added* warnings produced by this event. Warnings
 *     that go away (e.g. a `manifest_nav_missing_target` invalidated by an
 *     `add` of the missing file) are reflected by `space.warnings` shrinking,
 *     not by negative entries in the delta.
 *   - Never re-scans the whole tree. That's `load()`'s job.
 */

import { join, posix } from 'node:path';
import {
	load as pureLoad,
	buildPage,
	readManifest,
	resolveNav,
	normalizeUrl,
	normalizeRelativePath,
	LoadError
} from './load.ts';
import { SpaceCache } from './cache.ts';
import { bodyHash } from '$lib/render/cache';
import { logger } from '$lib/server/logger';
import type {
	AmberManifest,
	LoadWarning,
	Page,
	ResolvedNavEntry,
	Space as SpaceData
} from '$lib/types/schema';

const log = logger.child({ subsystem: 'space' });

export type FsEvent =
	| { type: 'add'; path: string }
	| { type: 'change'; path: string }
	| { type: 'unlink'; path: string }
	| { type: 'manifest_change' };

export class Space implements SpaceData {
	readonly root: string;
	manifest: AmberManifest;
	readonly pages: Map<string, Page>;
	nav: ResolvedNavEntry[];
	redirects: Map<string, string>;
	readonly warnings: LoadWarning[];

	/** url → Page is the public view; rel → Page is the index for path-keyed events. */
	private readonly pagesByRel: Map<string, Page>;

	/** Per-page frontmatter_parse_error warnings, keyed by relative path. */
	private readonly pageWarningByRel: Map<string, LoadWarning>;

	/**
	 * duplicate_url warnings for pages that were *dropped* (the loser of a
	 * url collision). Keyed by the loser's relative path so we can clear it
	 * when that file is changed or unlinked.
	 *
	 * Limitation: if the *winner* of a collision is unlinked, we don't
	 * auto-promote the previously-suppressed loser — that requires either
	 * keeping the loser's content around or re-reading it from disk. A
	 * subsequent `change` event on the loser does the right thing, and a
	 * cold start will pick the loser correctly.
	 */
	private readonly dupeWarningByRel: Map<string, LoadWarning>;

	/** Warnings produced by nav resolution; recomputed on every nav reconcile. */
	private navWarnings: LoadWarning[];

	private cache: SpaceCache | null;

	private constructor(initial: SpaceData, cache: SpaceCache | null) {
		this.root = initial.root;
		this.manifest = initial.manifest;
		this.pages = initial.pages;
		this.nav = initial.nav;
		this.redirects = initial.redirects;
		this.warnings = [];
		this.cache = cache;

		this.pagesByRel = new Map();
		for (const page of this.pages.values()) {
			this.pagesByRel.set(page.relativePath, page);
		}

		this.pageWarningByRel = new Map();
		this.dupeWarningByRel = new Map();
		this.navWarnings = [];

		// Distribute the initial warnings across our buckets.
		for (const w of initial.warnings) {
			switch (w.code) {
				case 'frontmatter_parse_error':
					if (w.source) this.pageWarningByRel.set(w.source, w);
					break;
				case 'duplicate_url':
					if (w.source) this.dupeWarningByRel.set(w.source, w);
					break;
				case 'manifest_nav_missing_target':
				case 'reserved_name_in_content':
				case 'redirect_loop':
					this.navWarnings.push(w);
					break;
			}
		}
		this.recomputeWarnings();
	}

	/**
	 * Cold-start the space. Tries to hydrate from `.amber/cache.db`; falls
	 * through to the pure `load()` if the cache is absent or stale, and
	 * writes a fresh cache before returning.
	 *
	 * Pass `{ cache: false }` to bypass SQLite entirely — useful for unit
	 * tests that don't want filesystem side effects beyond the space
	 * directory itself.
	 */
	static load(
		spacePath: string,
		options?: { cache?: boolean }
	): { space: Space; warnings: LoadWarning[] } {
		const useCache = options?.cache !== false;
		if (!useCache) {
			const result = pureLoad(spacePath);
			const space = new Space(result.space, null);
			return { space, warnings: space.warnings };
		}

		const cache = new SpaceCache(spacePath);
		const hydrated = cache.tryHydrate(spacePath);
		if (hydrated) {
			const space = new Space(hydrated.space, cache);
			// Hydration skips the writeAll path, but render orphans can still
			// have accumulated across previous runs — vacuum opportunistically.
			const removed = space.vacuumRenderCache();
			if (removed > 0) {
				log.info({ removed }, 'vacuumed orphan renders');
			}
			return { space, warnings: space.warnings };
		}

		const result = pureLoad(spacePath);
		const space = new Space(result.space, cache);
		// Persist a fresh cache reflecting the in-memory truth. `writeAll`
		// also detects body-hash-stable renames against the previous snapshot
		// and returns the live auto-rename redirect set (with stale entries
		// already evicted) — merge them into the in-memory redirects map so
		// the rename takes effect on this same load.
		const autoRedirects = cache.writeAll({
			root: space.root,
			manifest: space.manifest,
			pages: space.pages,
			nav: space.nav,
			redirects: space.redirects,
			warnings: space.warnings
		});
		// Order: manifest + frontmatter were merged in pureLoad. Auto-renames
		// layer on top but skip any source URL that is already a live page or
		// already explicitly redirected by manifest / frontmatter — explicit
		// user intent beats inference.
		for (const [from, to] of autoRedirects) {
			if (space.pages.has(from)) continue;
			if (space.redirects.has(from)) continue;
			space.redirects.set(from, to);
		}
		// After a cold load, drop any render rows whose body hash isn't
		// referenced by a current page. Bounded by page count; cheap.
		const removed = space.vacuumRenderCache();
		if (removed > 0) {
			console.log(`[amber] vacuumed ${removed} orphan renders`);
		}
		return { space, warnings: space.warnings };
	}

	apply(event: FsEvent): LoadWarning[] {
		const before = new Set(this.warnings.map(serializeWarning));

		switch (event.type) {
			case 'add':
				this.applyAdd(event.path);
				break;
			case 'change':
				this.applyChange(event.path);
				break;
			case 'unlink':
				this.applyUnlink(event.path);
				break;
			case 'manifest_change':
				this.applyManifestChange();
				break;
		}

		this.reconcileNav();
		this.recomputeWarnings();

		// Persist the affected slice of the cache. Failures inside the cache
		// are logged and swallowed — the in-memory index is the truth.
		if (this.cache) {
			if (event.type === 'unlink') {
				this.cache.deletePage(normalizeRelativePath(event.path));
			} else if (event.type === 'add' || event.type === 'change') {
				const rel = normalizeRelativePath(event.path);
				const page = this.pagesByRel.get(rel);
				if (page) {
					this.cache.upsertPage(page);
				} else {
					// Page wasn't indexed (e.g. dropped as a duplicate, or
					// vanished mid-flight). Make sure the cache doesn't hold
					// a stale row for it either.
					this.cache.deletePage(rel);
				}
			} else if (event.type === 'manifest_change') {
				this.cache.updateManifestMtime(this.root);
			}
			this.cache.replacePageWarnings(this.warnings);
		}

		return this.warnings.filter((w) => !before.has(serializeWarning(w)));
	}

	close(): void {
		if (this.cache) {
			this.cache.close();
			this.cache = null;
		}
	}

	/**
	 * Read a cached HTML render by content hash, or null on miss / cacheless
	 * mode. The render layer owns the hash format — this is just a passthrough
	 * to the SQLite row.
	 */
	getCachedRender(contentHash: string): string | null {
		return this.cache ? this.cache.getRender(contentHash) : null;
	}

	/** Persist a rendered HTML string under its content hash. No-op when the cache is off. */
	putCachedRender(contentHash: string, html: string): void {
		this.cache?.putRender(contentHash, html);
	}

	/**
	 * Drop any rows from the render cache that no longer correspond to a
	 * live `Page.body`. Returns the number of rows deleted; 0 when the
	 * cache is off.
	 *
	 * Called once per cold start from `Space.load()`. Not wired into
	 * `apply()` — orphan churn from a single event is tiny, and per-event
	 * rescans of every page body would dominate the apply cost.
	 */
	vacuumRenderCache(): number {
		if (!this.cache) return 0;
		const active = new Set<string>();
		for (const page of this.pages.values()) {
			active.add(bodyHash(page.body));
		}
		return this.cache.vacuum(active);
	}

	// ─── apply helpers ────────────────────────────────────────────────────

	private applyAdd(rawPath: string): void {
		const rel = normalizeRelativePath(rawPath);
		// `add` for an existing page is treated as a `change`; chokidar can
		// emit either depending on platform.
		this.parseAndIndex(rel);
	}

	private applyChange(rawPath: string): void {
		const rel = normalizeRelativePath(rawPath);
		this.parseAndIndex(rel);
	}

	private applyUnlink(rawPath: string): void {
		const rel = normalizeRelativePath(rawPath);
		const existing = this.pagesByRel.get(rel);
		if (existing) {
			this.pages.delete(existing.url);
			this.pagesByRel.delete(rel);
		}
		this.pageWarningByRel.delete(rel);
		this.dupeWarningByRel.delete(rel);
	}

	private applyManifestChange(): void {
		// Re-read amber.toml and recompute redirects. Nav reconciles via
		// `reconcileNav` after this returns.
		try {
			this.manifest = readManifest(this.root);
		} catch (err) {
			// Manifest parse errors aren't a `LoadWarning` — pure load throws
			// LoadError on bad manifests. Surface the throw to the caller; the
			// watcher decides whether to retry or report.
			if (err instanceof LoadError) throw err;
			throw err;
		}
		const redirects = new Map<string, string>();
		if (this.manifest.redirects) {
			for (const [from, to] of Object.entries(this.manifest.redirects)) {
				redirects.set(normalizeUrl(from), normalizeUrl(to));
			}
		}
		this.redirects = redirects;
	}

	private parseAndIndex(rel: string): void {
		const filePath = join(this.root, ...rel.split(posix.sep));
		let result: ReturnType<typeof buildPage>;
		try {
			result = buildPage(this.root, filePath);
		} catch (err) {
			// The file vanished between event emission and parsing, or
			// `slug:` on `index.md` (a LoadError). Treat the former as an
			// unlink; let the latter surface.
			if (err instanceof LoadError) throw err;
			this.applyUnlink(rel);
			return;
		}
		const { page, warning } = result;

		// If a page existed under this relativePath already (a `change`),
		// retire its old URL slot first.
		const previous = this.pagesByRel.get(rel);
		if (previous) {
			// Only delete the old url slot if it actually held *this* page.
			const occupant = this.pages.get(previous.url);
			if (occupant && occupant.relativePath === rel) {
				this.pages.delete(previous.url);
			}
		}
		this.pageWarningByRel.delete(rel);
		this.dupeWarningByRel.delete(rel);

		// URL collision: someone else owns this URL.
		const collider = this.pages.get(page.url);
		if (collider && collider.relativePath !== rel) {
			this.dupeWarningByRel.set(rel, {
				code: 'duplicate_url',
				message: `Two pages resolve to ${page.url}; keeping the first.`,
				source: rel
			});
			// Drop the new page; it isn't indexed.
			this.pagesByRel.delete(rel);
		} else {
			this.pages.set(page.url, page);
			this.pagesByRel.set(rel, page);
		}

		if (warning) {
			this.pageWarningByRel.set(rel, warning);
		}
	}

	private reconcileNav(): void {
		const navWarnings: LoadWarning[] = [];
		this.nav = this.manifest.nav ? resolveNav(this.manifest.nav, this.pagesByRel, navWarnings) : [];
		this.navWarnings = navWarnings;
	}

	private recomputeWarnings(): void {
		this.warnings.length = 0;
		// Stable order: per-page warnings sorted by relativePath, then dupe
		// warnings, then nav warnings (in resolution order).
		const pageRels = [...this.pageWarningByRel.keys()].sort();
		for (const rel of pageRels) this.warnings.push(this.pageWarningByRel.get(rel)!);
		const dupeRels = [...this.dupeWarningByRel.keys()].sort();
		for (const rel of dupeRels) this.warnings.push(this.dupeWarningByRel.get(rel)!);
		for (const w of this.navWarnings) this.warnings.push(w);
	}
}

function serializeWarning(w: LoadWarning): string {
	return `${w.code} ${w.source ?? ''} ${w.message}`;
}
