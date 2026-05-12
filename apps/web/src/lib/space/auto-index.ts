/**
 * The `auto_index` frontmatter primitive (Wave 3 P1).
 *
 * Two halves:
 *   - `validateAutoIndex(raw, root)` — load-time. Validate and normalize a raw
 *     `auto_index` value read from YAML frontmatter against the content root.
 *     Returns the normalized `AutoIndexDirective` or the `LoadWarning` the
 *     caller should emit (the caller drops the directive; the page still
 *     renders). Pure apart from a `statSync` to confirm `path` is a directory.
 *   - `resolveAutoIndexEntries(pages, host, directive)` — render-time. Build
 *     the sorted, limited `{href,title,date,updated}` array from the *live*
 *     page set (so it stays reactive to watcher updates). Pure — no filesystem.
 *
 * Filtering rules (see docs/p1.md): the host page is always excluded (a page
 * can't list itself even if it lives under `path`); only pages whose relative
 * path is *inside* the directory (`<path>/...`) are listed; drafts are
 * excluded. (Drafts aren't named in docs/p1.md — excluding them mirrors the
 * nav builder and the page handler, which also hide drafts from public
 * surfaces while dev still serves them as standalone pages.) There is no tag
 * or prefix filtering — out of scope.
 */

import { statSync } from 'node:fs';
import { join, posix } from 'node:path';
import type { LoadWarning, Page, AutoIndexDirective, AutoIndexSort } from '$lib/types/schema';

export type { AutoIndexDirective, AutoIndexSort } from '$lib/types/schema';

/** One row passed to `partials/index.html` as an element of `index_entries`. */
export interface AutoIndexEntry {
	href: string;
	title: string;
	date: string | null;
	updated: string | null;
}

const SORTS: ReadonlySet<string> = new Set<AutoIndexSort>(['date desc', 'date asc', 'title asc']);
const DEFAULT_SORT: AutoIndexSort = 'date desc';

type WarningSeed = { code: LoadWarning['code']; message: string };
export type ValidateResult =
	| { ok: true; value: AutoIndexDirective }
	| { ok: false; warning: WarningSeed };

/**
 * Validate & normalize a raw `auto_index` value against the content root.
 * Order of checks: shape → `path` (string, normalize, exists as a directory)
 * → `sort` → `limit`. The first problem found wins (only one warning is
 * emitted per page for this directive).
 */
export function validateAutoIndex(raw: unknown, root: string): ValidateResult {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return {
			ok: false,
			warning: {
				code: 'auto_index_path_missing',
				message: 'auto_index must be a table with a `path`'
			}
		};
	}
	const r = raw as Record<string, unknown>;

	if (typeof r.path !== 'string' || r.path.trim() === '') {
		return {
			ok: false,
			warning: {
				code: 'auto_index_path_missing',
				message: 'auto_index.path is required and must be a non-empty string'
			}
		};
	}
	const segments = r.path.split(/[\\/]+/).filter((s) => s.length > 0 && s !== '.');
	if (segments.length === 0 || segments.some((s) => s === '..')) {
		return {
			ok: false,
			warning: {
				code: 'auto_index_path_missing',
				message: `auto_index.path ${JSON.stringify(r.path)} is not a valid content-root-relative directory`
			}
		};
	}
	const path = segments.join(posix.sep);
	try {
		if (!statSync(join(root, ...segments)).isDirectory()) {
			return {
				ok: false,
				warning: {
					code: 'auto_index_path_missing',
					message: `auto_index.path ${JSON.stringify(path)} is not a directory under the content root`
				}
			};
		}
	} catch {
		return {
			ok: false,
			warning: {
				code: 'auto_index_path_missing',
				message: `auto_index.path ${JSON.stringify(path)} does not exist under the content root`
			}
		};
	}

	let sort: AutoIndexSort = DEFAULT_SORT;
	if (r.sort !== undefined && r.sort !== null) {
		if (typeof r.sort !== 'string' || !SORTS.has(r.sort)) {
			return {
				ok: false,
				warning: {
					code: 'auto_index_invalid_sort',
					message: `auto_index.sort ${JSON.stringify(r.sort)} is not one of: "date desc", "date asc", "title asc"`
				}
			};
		}
		sort = r.sort as AutoIndexSort;
	}

	let limit: number | undefined;
	if (r.limit !== undefined && r.limit !== null) {
		if (typeof r.limit !== 'number' || !Number.isInteger(r.limit) || r.limit <= 0) {
			return {
				ok: false,
				warning: {
					code: 'auto_index_invalid_limit',
					message: `auto_index.limit must be a positive integer; got ${JSON.stringify(r.limit)}`
				}
			};
		}
		limit = r.limit;
	}

	return { ok: true, value: limit === undefined ? { path, sort } : { path, sort, limit } };
}

function titleOf(page: Page): string {
	return page.frontmatter.title ?? page.url;
}

function dateValue(page: Page): number | null {
	const d = page.frontmatter.date;
	if (!d) return null;
	const t = Date.parse(d);
	return Number.isNaN(t) ? null : t;
}

function compareTitles(a: Page, b: Page): number {
	// Case-insensitive, locale-aware. `sensitivity: 'base'` also folds accents
	// (é === e) — friendlier for mixed-language content than 'accent'. Pinned
	// locale ('en') so ordering is identical across dev/CI machines.
	return titleOf(a).localeCompare(titleOf(b), 'en', { sensitivity: 'base' });
}

function makeComparator(sort: AutoIndexSort): (a: Page, b: Page) => number {
	if (sort === 'title asc') return (a, b) => compareTitles(a, b) || a.url.localeCompare(b.url);
	// "date desc" / "date asc": pages with no parseable `date` sort last
	// regardless of direction; within the dated group, by direction with ties
	// broken by title for determinism; within the undated group, by title.
	return (a, b) => {
		const ta = dateValue(a);
		const tb = dateValue(b);
		if (ta !== null && tb !== null) {
			const diff = sort === 'date asc' ? ta - tb : tb - ta;
			return diff !== 0 ? diff : compareTitles(a, b);
		}
		if (ta !== null) return -1;
		if (tb !== null) return 1;
		return compareTitles(a, b);
	};
}

/**
 * Build the `index_entries` array for a host page's `auto_index` directive
 * from the current page set. Excludes the host, anything outside the directory,
 * and drafts. Sorted per `directive.sort`, then capped at `directive.limit`.
 */
export function resolveAutoIndexEntries(
	pages: Iterable<Page>,
	host: Page,
	directive: AutoIndexDirective
): AutoIndexEntry[] {
	const prefix = directive.path + posix.sep;
	const matched: Page[] = [];
	for (const page of pages) {
		if (page.relativePath === host.relativePath) continue;
		if (page.frontmatter.draft === true) continue;
		if (!page.relativePath.startsWith(prefix)) continue;
		matched.push(page);
	}
	matched.sort(makeComparator(directive.sort));
	const limited = directive.limit !== undefined ? matched.slice(0, directive.limit) : matched;
	// Fixed key order so JSON.stringify of the result is stable (V8 preserves
	// string-key insertion order) — callers may hash it.
	return limited.map((page) => ({
		href: page.url,
		title: titleOf(page),
		date: page.frontmatter.date ?? null,
		updated: page.frontmatter.updated ?? null
	}));
}
