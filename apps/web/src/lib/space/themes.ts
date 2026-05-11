/**
 * Theme discovery, active-theme resolution, and request-time template reads.
 *
 * Themes live at `<space-root>/themes/<name>/` ("themes" is a reserved
 * top-level name — content discovery skips it; this module is the consumer
 * that reads it). A theme directory is *usable* iff `theme.toml` parses and
 * all three template files exist on disk:
 *
 *   theme.toml    metadata (name, version, author, theme_color, footer)
 *   theme.css     stylesheet (served by the /themes asset route — not read here)
 *   chrome.html   site chrome with a `<!--amber:content-->` slot
 *   page.html     page body (title / date / rendered markdown)
 *   error.html    error / 404 body
 *
 * Incomplete or malformed theme directories are logged and skipped — never
 * fatal. Discovery runs once at cold start (and once on cache-hit hydration —
 * `themes/` isn't watched, so restart to pick up a new theme directory). It
 * reads/parses `theme.toml` but only *stats* the template files; the template
 * contents are read fresh at request time by `readTemplate`; the rendered
 * output of the page template is cached via the existing render-cache table
 * (see `+page.server.ts`).
 *
 * `fonts/` is optional and not touched here — it's served verbatim by the asset
 * route if a theme ships one. The amber-default theme uses a system font stack
 * and ships no fonts (SPIKE_NOTES).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

import { BUILTIN_THEME, BUILTIN_TEMPLATES } from '$lib/theme/builtin';
import type { AmberManifest, Theme, ThemeManifest } from '$lib/types/schema';
import type { Logger } from '$lib/server/logger';

export type TemplateKind = 'chrome' | 'page' | 'error';
const TEMPLATE_FILES: Record<TemplateKind, string> = {
	chrome: 'chrome.html',
	page: 'page.html',
	error: 'error.html'
};

export function discoverThemes(root: string, log: Logger): Map<string, Theme> {
	const themes = new Map<string, Theme>();
	const themesDir = join(root, 'themes');
	let entries: import('node:fs').Dirent[];
	try {
		entries = readdirSync(themesDir, { withFileTypes: true });
	} catch {
		return themes; // no themes/ directory — fine.
	}
	for (const entry of entries) {
		if (!entry.isDirectory()) continue;
		const name = entry.name;
		if (name.startsWith('.') || name.startsWith('_')) continue;
		const dir = join(themesDir, name);

		let manifest: ThemeManifest;
		try {
			const raw = readFileSync(join(dir, 'theme.toml'), 'utf8');
			const parsed = parseToml(raw);
			if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('theme.toml must be a table at the top level');
			}
			manifest = parsed as ThemeManifest;
		} catch (err) {
			log.warn(
				{ theme: name, err: err instanceof Error ? err.message : String(err) },
				`skipping theme "${name}": theme.toml missing or unparseable`
			);
			continue;
		}

		try {
			for (const file of Object.values(TEMPLATE_FILES)) {
				if (!statSync(join(dir, file)).isFile()) throw new Error(`${file} is not a file`);
			}
		} catch (err) {
			log.warn(
				{
					theme: name,
					err: err instanceof Error ? err.message : String(err),
					required: Object.values(TEMPLATE_FILES)
				},
				`skipping theme "${name}": a required template file is missing`
			);
			continue;
		}

		themes.set(name, { name, path: dir, assetBase: `/themes/${name}`, manifest });
	}
	return themes;
}

/**
 * Read a theme's template. For the in-app `BUILTIN_THEME` (`path === ''`) this
 * is the corresponding `BUILTIN_TEMPLATES` constant; otherwise it's
 * `<theme.path>/<kind>.html` read from disk at call time. A file deleted after
 * discovery surfaces as a thrown `ENOENT` (a misconfigured theme — let it 500;
 * don't paper over it).
 */
export function readTemplate(theme: Theme, kind: TemplateKind): string {
	if (theme.path === '') return BUILTIN_TEMPLATES[kind];
	return readFileSync(join(theme.path, TEMPLATE_FILES[kind]), 'utf8');
}

/** The directory name `theme = "..."` defaults to and falls back to. */
export const DEFAULT_THEME_NAME = 'amber-default';

/**
 * Pick the active theme: `manifest.theme` (a bare string or `{ name }`),
 * defaulting to `amber-default`, resolved against the discovered map. Unknown
 * name → log and fall back to `amber-default`. `amber-default` itself not
 * discovered → log and fall back to the in-app `BUILTIN_THEME`. Never null.
 */
export function resolveActiveTheme(
	themes: Map<string, Theme>,
	manifest: AmberManifest,
	log: Logger
): Theme {
	const configured =
		typeof manifest.theme === 'string'
			? manifest.theme
			: manifest.theme && typeof manifest.theme === 'object'
				? manifest.theme.name
				: undefined;
	const wanted = configured ?? DEFAULT_THEME_NAME;

	const hit = themes.get(wanted);
	if (hit) return hit;

	if (wanted !== DEFAULT_THEME_NAME) {
		log.error(
			{ wanted, available: [...themes.keys()] },
			`theme "${wanted}" not found under themes/; falling back to ${DEFAULT_THEME_NAME}`
		);
		const fallback = themes.get(DEFAULT_THEME_NAME);
		if (fallback) return fallback;
	}

	log.error(
		{ available: [...themes.keys()] },
		`no usable "${DEFAULT_THEME_NAME}" theme found under themes/; using the built-in fallback theme`
	);
	return BUILTIN_THEME;
}
