/**
 * Pure loader for an Amber space directory.
 *
 * Contract:
 *   load(spacePath: string): { space: Space; warnings: LoadWarning[] }
 *
 * Pure function. No globals, no env reads, no SQLite, no filesystem writes.
 * `amber.toml` is read but never rewritten — manifest is the user's file.
 *
 * Errors vs warnings:
 *   - Recoverable problems (missing nav targets, malformed frontmatter,
 *     duplicate URLs, references into reserved space) become `LoadWarning`s
 *     in the returned `warnings` array; the rest of the space still loads.
 *   - Semantically incoherent inputs (e.g. `slug:` on an `index.md`, missing
 *     `amber.toml`, missing `amber_version`) throw a typed `LoadError`. The
 *     return shape stays narrow — callers either get a valid Space or a
 *     thrown error they can catch.
 *
 * Out of scope here: watcher, SQLite cache writes, HTML rendering, draft
 * filtering. The loader produces an index of what exists; consumers decide
 * what to expose.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, posix, basename, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { parse as parseToml } from 'smol-toml';
import { parse as parseYaml } from 'yaml';

import { logger } from '$lib/server/logger';
import {
	RESERVED_TOP_LEVEL,
	isReservedPath,
	type AmberManifest,
	type LoadWarning,
	type NavEntry,
	type Page,
	type PageFrontmatter,
	type Space,
	type Theme
} from '$lib/types/schema';
import { discoverThemes, resolveActiveTheme, effectiveThemes } from './themes.ts';
import { readSpaceConfig } from './config.ts';
import { validateAutoIndex } from './auto-index.ts';

const redirectsLog = logger.child({ subsystem: 'redirects' });
const log = logger.child({ subsystem: 'loader' });

export class LoadError extends Error {
	constructor(
		message: string,
		public readonly source?: string
	) {
		super(message);
		this.name = 'LoadError';
	}
}

/**
 * Matches a leading YAML frontmatter block: a `---` line opens it, a `---`
 * (or `...`) line closes it. Group 1 is the inner YAML. `match[0]` is the
 * whole block including delimiters and the closing newline. Exported so the
 * editor (`lib/server/editor.ts`) can capture the verbatim block without
 * re-declaring the pattern.
 */
export const FRONTMATTER_BLOCK_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/;

const FRONTMATTER_KEYS: ReadonlySet<keyof PageFrontmatter> = new Set([
	'title',
	'description',
	'slug',
	'draft',
	'date',
	'updated',
	'author',
	'tags',
	'layout',
	'redirect_from',
	'auto_index'
]);

/** Frontmatter keys whose values are interpreted as ISO 8601 dates. */
const DATE_FIELDS: readonly (keyof PageFrontmatter)[] = ['date', 'updated'];

/**
 * Coerce a frontmatter date value to an ISO 8601 string.
 *
 * Convention: `date` (and `updated`) are ISO 8601 strings everywhere. Authors
 * may write either `date: 2026-05-10` (YAML-native, parsed by some YAML
 * configurations as a Date object) or `date: "2026-05-10"` (quoted string).
 * Both are accepted; the loader normalizes to a string in memory so consumers
 * (themes, sort keys, RSS) see a single shape.
 *
 * Returns `{ value: string }` for accepted inputs, `{ error: string }` for
 * invalid ones. The caller surfaces invalid values as a
 * `frontmatter_parse_error` warning and drops the field from the frontmatter
 * (treats it as undefined). Missing values never reach this function.
 */
export function coerceDate(input: unknown): { value: string } | { error: string } {
	if (input instanceof Date) {
		const t = input.getTime();
		if (Number.isNaN(t)) return { error: 'date is an Invalid Date' };
		return { value: input.toISOString() };
	}
	if (typeof input === 'string') {
		const trimmed = input.trim();
		if (trimmed === '') return { error: 'date is an empty string' };
		if (!Number.isFinite(Date.parse(trimmed))) {
			return { error: `date is not a valid ISO 8601 string: ${JSON.stringify(input)}` };
		}
		return { value: trimmed };
	}
	return {
		error: `date must be an ISO 8601 string or YAML date, got ${typeof input}: ${JSON.stringify(input)}`
	};
}

export function load(
	spacePath: string,
	sharedThemes: Map<string, Theme> = new Map()
): { space: Space; warnings: LoadWarning[] } {
	const root = resolve(spacePath);
	const warnings: LoadWarning[] = [];

	const manifest = readManifest(root);

	const pages = new Map<string, Page>();
	const pagesByRelativePath = new Map<string, Page>();
	walkContent(root, root, pages, pagesByRelativePath, warnings);

	const nav = manifest.nav ? resolveNav(manifest.nav) : [];

	const redirects = new Map<string, string>();
	if (manifest.redirects) {
		for (const [from, to] of Object.entries(manifest.redirects)) {
			redirects.set(normalizeUrl(from), normalizeUrl(to));
		}
	}
	mergeFrontmatterRedirects(pages, redirects, 'manifest');

	const themes = effectiveThemes(sharedThemes, discoverThemes(root, log));

	const { config: spaceConfig, warnings: spaceConfigWarnings } = readSpaceConfig(root);
	for (const w of spaceConfigWarnings) warnings.push(w);

	const { theme, warnings: themeWarnings } = resolveActiveTheme(themes, manifest, spaceConfig, log);
	for (const w of themeWarnings) warnings.push(w);

	const space: Space = { root, manifest, pages, nav, redirects, warnings, themes, theme };
	return { space, warnings };
}

/**
 * Walk every page's `redirect_from` frontmatter and merge entries into the
 * redirects map. Conflicts (a source already present from an earlier source —
 * the manifest, another page, or persisted auto-renames) are last-write-wins
 * and logged for visibility. No `LoadWarning` is emitted because the schema's
 * code set doesn't include a frontmatter-redirect-conflict variant; adding a
 * code is out of scope here.
 *
 * Per-page validation: if `redirect_from` exists but isn't a `string[]`, log
 * once for that page and skip its redirects entirely. Individual entries that
 * aren't non-empty strings are skipped silently. The page itself is unaffected
 * — only the redirects it contributed are dropped.
 *
 * The `prior` argument names the source already in the map at call time, used
 * only for log messages: "manifest" when called with manifest entries
 * pre-seeded, "manifest+auto-rename" when called from the cache hot path with
 * manifest + persisted auto-renames pre-seeded.
 */
export function mergeFrontmatterRedirects(
	pages: Map<string, Page>,
	redirects: Map<string, string>,
	prior: string
): void {
	for (const page of pages.values()) {
		const sources = page.frontmatter.redirect_from;
		if (sources === undefined) continue;
		if (!Array.isArray(sources) || !sources.every((entry) => typeof entry === 'string')) {
			redirectsLog.warn(
				{ page: page.relativePath, value: sources },
				`redirect_from on ${page.relativePath} is not a string array; skipping its redirects`
			);
			continue;
		}
		for (const rawFrom of sources) {
			if (rawFrom.trim() === '') continue;
			const from = normalizeUrl(rawFrom);
			const to = page.url;
			const existing = redirects.get(from);
			if (existing !== undefined && existing !== to) {
				redirectsLog.warn(
					{ from, prior_target: existing, new_target: to, page: page.relativePath },
					`redirect_from conflict: ${from} previously mapped (via ${prior} or earlier page) to ${existing}; ${page.relativePath} now overrides it to ${to}`
				);
			}
			redirects.set(from, to);
		}
	}
}

export function readManifest(root: string): AmberManifest {
	const path = join(root, 'amber.toml');
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		throw new LoadError(`amber.toml not found at ${path}`, 'amber.toml');
	}
	let parsed: unknown;
	try {
		parsed = parseToml(raw);
	} catch (err) {
		throw new LoadError(
			`amber.toml failed to parse: ${err instanceof Error ? err.message : String(err)}`,
			'amber.toml'
		);
	}
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new LoadError('amber.toml must be a table at the top level', 'amber.toml');
	}
	const m = parsed as Record<string, unknown>;
	if (typeof m.amber_version !== 'string') {
		throw new LoadError('amber.toml is missing required `amber_version`', 'amber.toml');
	}
	// Light shape coercion — TOML parsers return plain objects/arrays that
	// already match the schema for this fixture's surface area.
	return parsed as AmberManifest;
}

// TODO: symlinks aren't validated — revisit when a real use case appears.
function walkContent(
	root: string,
	dir: string,
	pages: Map<string, Page>,
	byRelative: Map<string, Page>,
	warnings: LoadWarning[]
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
		// At the top level the full reserved set applies (amber.toml, .amber/,
		// themes/, plus _*/.* prefixes). At depth only the prefix rules apply.
		if (isTopLevel) {
			if (isReservedPath(name)) continue;
		} else {
			if (name.startsWith('_') || name.startsWith('.')) continue;
			// `themes` is only reserved at the top level — a folder named "themes"
			// nested inside content is allowed.
			if (RESERVED_TOP_LEVEL.has(name) && name !== 'themes') continue;
		}
		const full = join(dir, name);
		if (entry.isDirectory()) {
			walkContent(root, full, pages, byRelative, warnings);
		} else if (entry.isFile() && name.toLowerCase().endsWith('.md')) {
			loadPage(root, full, pages, byRelative, warnings);
		}
	}
}

function loadPage(
	root: string,
	filePath: string,
	pages: Map<string, Page>,
	byRelative: Map<string, Page>,
	warnings: LoadWarning[]
): void {
	const { page, warnings: pageWarnings } = buildPage(root, filePath);
	for (const w of pageWarnings) warnings.push(w);

	if (pages.has(page.url)) {
		warnings.push({
			code: 'duplicate_url',
			message: `Two pages resolve to ${page.url}; keeping the first.`,
			source: page.relativePath
		});
		return;
	}
	pages.set(page.url, page);
	byRelative.set(page.relativePath, page);
}

/**
 * Read and parse a single markdown file into a `Page`. Pure-ish (touches the
 * filesystem to read the file, stat it, and — for an `auto_index` directive —
 * stat the referenced directory) but stateless: no maps, no cross-page
 * concerns. `duplicate_url` lives at the call site.
 *
 * Warnings returned (zero or more, in this order):
 *   - `frontmatter_parse_error` — block-level YAML parse failure and/or
 *     per-field validation failures (e.g. bad `date`), combined into one entry.
 *   - one of `auto_index_path_missing` / `auto_index_invalid_sort` /
 *     `auto_index_invalid_limit` — the page's `auto_index` is malformed; the
 *     directive is dropped from `frontmatter`, the page is otherwise unaffected.
 */
export function buildPage(root: string, filePath: string): { page: Page; warnings: LoadWarning[] } {
	const rel = relative(root, filePath).split(sep).join(posix.sep);
	const rawFromDisk = readFileSync(filePath, 'utf8');
	// Strip a leading UTF-8 BOM so the same logical file produces the same
	// hash, frontmatter, and body whether or not it was saved with one.
	const raw = rawFromDisk.charCodeAt(0) === 0xfeff ? rawFromDisk.slice(1) : rawFromDisk;
	const stat = statSync(filePath);
	const contentHash = createHash('sha256').update(raw).digest('hex');

	const { frontmatter, extra, body, parseError, fieldErrors } = splitFrontmatter(raw);

	const warnings: LoadWarning[] = [];

	// Combine block-level parse error and per-field validation errors into a
	// single `frontmatter_parse_error` so each problem is one sentence in one
	// message.
	const messages: string[] = [];
	if (parseError) messages.push(`Frontmatter failed to parse: ${parseError}`);
	for (const fieldError of fieldErrors) messages.push(fieldError);
	if (messages.length > 0) {
		warnings.push({ code: 'frontmatter_parse_error', message: messages.join(' '), source: rel });
	}

	// `auto_index`: validate & normalize against the content root, or drop the
	// directive with a structured warning. (Done here rather than in
	// `splitFrontmatter` because it needs `root` to stat the target directory.)
	if (frontmatter.auto_index !== undefined) {
		const result = validateAutoIndex(frontmatter.auto_index, root);
		if (result.ok) {
			frontmatter.auto_index = result.value;
		} else {
			delete frontmatter.auto_index;
			warnings.push({ ...result.warning, source: rel });
		}
	}

	const url = deriveUrl(rel, frontmatter.slug);
	const page: Page = {
		filePath,
		relativePath: rel,
		url,
		frontmatter,
		extra,
		body,
		mtime: stat.mtimeMs,
		contentHash
	};

	return { page, warnings };
}

export function splitFrontmatter(raw: string): {
	frontmatter: PageFrontmatter;
	extra: Record<string, unknown>;
	body: string;
	parseError?: string;
	/** Per-field validation messages (e.g. invalid `date`). One entry per failed field. */
	fieldErrors: string[];
} {
	// A leading `---` line opens the YAML block; a `---` (or `...`) line closes it.
	const match = FRONTMATTER_BLOCK_RE.exec(raw);
	if (!match) {
		// No frontmatter is fine — return the raw text as the body, with line
		// endings normalized so cached HTML is deterministic across platforms.
		return {
			frontmatter: {},
			extra: {},
			body: raw.replace(/\r\n/g, '\n'),
			fieldErrors: []
		};
	}
	// Normalize CRLF→LF in both the YAML block and the body. Most YAML parsers
	// tolerate CRLF, but normalizing here keeps downstream hashing/rendering
	// deterministic regardless of how the file was authored.
	const yamlBlock = match[1].replace(/\r\n/g, '\n');
	const body = raw.slice(match[0].length).replace(/\r\n/g, '\n');
	let parsed: unknown;
	try {
		parsed = parseYaml(yamlBlock);
	} catch (err) {
		return {
			frontmatter: {},
			extra: {},
			body,
			parseError: err instanceof Error ? err.message : String(err),
			fieldErrors: []
		};
	}
	if (parsed == null) {
		return { frontmatter: {}, extra: {}, body, fieldErrors: [] };
	}
	if (typeof parsed !== 'object' || Array.isArray(parsed)) {
		return {
			frontmatter: {},
			extra: {},
			body,
			parseError: 'frontmatter must be a YAML mapping',
			fieldErrors: []
		};
	}
	const frontmatter: PageFrontmatter = {};
	const extra: Record<string, unknown> = {};
	const fieldErrors: string[] = [];
	for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
		if (FRONTMATTER_KEYS.has(k as keyof PageFrontmatter)) {
			// Date fields get coerced to ISO 8601 strings. Invalid values are
			// dropped (treated as undefined) and surfaced as warnings; the rest
			// of the page still loads.
			if (DATE_FIELDS.includes(k as keyof PageFrontmatter) && v !== undefined && v !== null) {
				const result = coerceDate(v);
				if ('error' in result) {
					fieldErrors.push(`Invalid \`${k}\` frontmatter: ${result.error}`);
					continue;
				}
				(frontmatter as Record<string, unknown>)[k] = result.value;
			} else {
				(frontmatter as Record<string, unknown>)[k] = v;
			}
		} else {
			extra[k] = v;
		}
	}
	return { frontmatter, extra, body, fieldErrors };
}

export function deriveUrl(relativePath: string, slug: string | undefined): string {
	const isIndex = basename(relativePath) === 'index.md';
	if (isIndex && slug !== undefined) {
		throw new LoadError(
			`slug: on index.md is semantically incoherent — index URLs come from the parent directory, not the filename. ` +
				`Rename the file or restructure to choose a different URL.`,
			relativePath
		);
	}
	if (isIndex) {
		const parent = dirname(relativePath);
		if (parent === '.' || parent === '') return '/';
		return '/' + parent.split(sep).join(posix.sep);
	}
	const parent = dirname(relativePath);
	const stem = basename(relativePath).replace(/\.md$/i, '');
	const segment = slug ?? stem;
	if (parent === '.' || parent === '') return '/' + segment;
	return '/' + parent.split(sep).join(posix.sep) + '/' + segment;
}

/**
 * Validate a manifest's `[[nav]]` table into a flat list of `{ label, href }`
 * links. Both fields are required strings; missing or wrong-type entries are
 * skipped with a structured log line and the rest pass through. `href` is not
 * resolved against the page index — themes render whatever the author wrote.
 *
 * Extra keys on a `[[nav]]` table are silently ignored, leaving room for
 * forward-compatible additions without a schema bump.
 *
 * No `LoadWarning` is emitted: none of the existing codes match a v0.2 nav
 * shape error, and adding a new code for a single-line skip is not worth
 * the schema churn. The log line is the user-visible signal.
 */
export function resolveNav(entries: unknown): NavEntry[] {
	if (!Array.isArray(entries)) return [];
	const out: NavEntry[] = [];
	for (let i = 0; i < entries.length; i++) {
		const raw = entries[i];
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			log.warn({ index: i, entry: raw }, 'skipping malformed nav entry: not a table');
			continue;
		}
		const e = raw as Record<string, unknown>;
		if (typeof e.label !== 'string') {
			log.warn({ index: i, entry: raw }, 'skipping nav entry: missing or non-string `label`');
			continue;
		}
		if (typeof e.href !== 'string') {
			log.warn(
				{ index: i, label: e.label, entry: raw },
				'skipping nav entry: missing or non-string `href`'
			);
			continue;
		}
		out.push({ label: e.label, href: e.href });
	}
	return out;
}

export function normalizeRelativePath(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).join(posix.sep);
}

export function normalizeUrl(u: string): string {
	let s = u.trim();
	if (!s.startsWith('/')) s = '/' + s;
	if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
	return s;
}
