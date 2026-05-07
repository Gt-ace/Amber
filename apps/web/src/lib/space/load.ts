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

import {
	RESERVED_TOP_LEVEL,
	isReservedPath,
	type AmberManifest,
	type LoadWarning,
	type NavEntry,
	type Page,
	type PageFrontmatter,
	type ResolvedNavEntry,
	type Space
} from '$lib/types/schema';

export class LoadError extends Error {
	constructor(
		message: string,
		public readonly source?: string
	) {
		super(message);
		this.name = 'LoadError';
	}
}

const FRONTMATTER_KEYS: ReadonlySet<keyof PageFrontmatter> = new Set([
	'title',
	'description',
	'slug',
	'draft',
	'date',
	'updated',
	'author',
	'tags',
	'layout'
]);

export function load(spacePath: string): { space: Space; warnings: LoadWarning[] } {
	const root = resolve(spacePath);
	const warnings: LoadWarning[] = [];

	const manifest = readManifest(root);

	const pages = new Map<string, Page>();
	const pagesByRelativePath = new Map<string, Page>();
	walkContent(root, root, pages, pagesByRelativePath, warnings);

	const nav = manifest.nav ? resolveNav(manifest.nav, pagesByRelativePath, warnings) : [];

	const redirects = new Map<string, string>();
	if (manifest.redirects) {
		for (const [from, to] of Object.entries(manifest.redirects)) {
			redirects.set(normalizeUrl(from), normalizeUrl(to));
		}
	}

	const space: Space = { root, manifest, pages, nav, redirects, warnings };
	return { space, warnings };
}

function readManifest(root: string): AmberManifest {
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
	const rel = relative(root, filePath).split(sep).join(posix.sep);
	const raw = readFileSync(filePath, 'utf8');
	const stat = statSync(filePath);
	const contentHash = createHash('sha256').update(raw).digest('hex');

	const { frontmatter, extra, body, parseError } = splitFrontmatter(raw);

	if (parseError) {
		warnings.push({
			code: 'frontmatter_parse_error',
			message: `Frontmatter failed to parse: ${parseError}`,
			source: rel
		});
		// Include the page with empty frontmatter so the rest of the space builds.
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

	if (pages.has(url)) {
		warnings.push({
			code: 'duplicate_url',
			message: `Two pages resolve to ${url}; keeping the first.`,
			source: rel
		});
		return;
	}
	pages.set(url, page);
	byRelative.set(rel, page);
}

function splitFrontmatter(raw: string): {
	frontmatter: PageFrontmatter;
	extra: Record<string, unknown>;
	body: string;
	parseError?: string;
} {
	// A leading `---` line opens the YAML block; a `---` (or `...`) line closes it.
	const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)\r?\n?/.exec(raw);
	if (!match) {
		return { frontmatter: {}, extra: {}, body: raw };
	}
	const yamlBlock = match[1];
	const body = raw.slice(match[0].length);
	let parsed: unknown;
	try {
		parsed = parseYaml(yamlBlock);
	} catch (err) {
		return {
			frontmatter: {},
			extra: {},
			body,
			parseError: err instanceof Error ? err.message : String(err)
		};
	}
	if (parsed == null) {
		return { frontmatter: {}, extra: {}, body };
	}
	if (typeof parsed !== 'object' || Array.isArray(parsed)) {
		return {
			frontmatter: {},
			extra: {},
			body,
			parseError: 'frontmatter must be a YAML mapping'
		};
	}
	const frontmatter: PageFrontmatter = {};
	const extra: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
		if (FRONTMATTER_KEYS.has(k as keyof PageFrontmatter)) {
			(frontmatter as Record<string, unknown>)[k] = v;
		} else {
			extra[k] = v;
		}
	}
	return { frontmatter, extra, body };
}

function deriveUrl(relativePath: string, slug: string | undefined): string {
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

function resolveNav(
	entries: NavEntry[],
	byRelative: Map<string, Page>,
	warnings: LoadWarning[]
): ResolvedNavEntry[] {
	const out: ResolvedNavEntry[] = [];
	for (const entry of entries) {
		const kind = inferKind(entry);
		if (kind === 'page') {
			const e = entry as { kind?: 'page'; path: string; label?: string };
			const path = e.path;
			if (pathContainsReservedSegment(path)) {
				warnings.push({
					code: 'reserved_name_in_content',
					message: `Manifest nav references a path inside reserved space: ${path}`,
					source: path
				});
				continue;
			}
			const page = byRelative.get(normalizeRelativePath(path));
			if (!page) {
				warnings.push({
					code: 'manifest_nav_missing_target',
					message: `Manifest nav references a missing page: ${path}`,
					source: path
				});
				continue;
			}
			out.push({
				kind: 'page',
				label: e.label ?? page.frontmatter.title ?? page.url,
				url: page.url,
				page
			});
		} else if (kind === 'external') {
			const e = entry as { kind?: 'external'; label: string; url: string };
			out.push({ kind: 'external', label: e.label, url: e.url });
		} else if (kind === 'group') {
			const e = entry as { kind: 'group'; label: string; children: NavEntry[] };
			out.push({
				kind: 'group',
				label: e.label,
				children: resolveNav(e.children, byRelative, warnings)
			});
		}
	}
	return out;
}

function inferKind(entry: NavEntry): 'page' | 'external' | 'group' {
	const e = entry as unknown as Record<string, unknown>;
	if (typeof e.kind === 'string') return e.kind as 'page' | 'external' | 'group';
	if (typeof e.path === 'string') return 'page';
	if (typeof e.url === 'string') return 'external';
	if (Array.isArray(e.children)) return 'group';
	throw new LoadError(`nav entry has no kind and is not inferrable: ${JSON.stringify(entry)}`);
}

function pathContainsReservedSegment(path: string): boolean {
	const segments = path.split(/[\\/]/).filter(Boolean);
	return segments.some((s) => s.startsWith('_') || s.startsWith('.') || RESERVED_TOP_LEVEL.has(s));
}

function normalizeRelativePath(p: string): string {
	return p.split(/[\\/]/).filter(Boolean).join(posix.sep);
}

function normalizeUrl(u: string): string {
	let s = u.trim();
	if (!s.startsWith('/')) s = '/' + s;
	if (s.length > 1 && s.endsWith('/')) s = s.slice(0, -1);
	return s;
}
