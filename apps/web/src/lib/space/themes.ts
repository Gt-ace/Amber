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
 *
 * `theme.js` is optional too — when present it's statted (not read) so the
 * Theme carries `hasScript`, letting the layout emit a `<script type="module">`
 * tag for it. Absence is silent, like a missing `partials/` or `fonts/`.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

import { BUILTIN_THEME, BUILTIN_TEMPLATES, BUILTIN_PARTIALS } from '$lib/theme/builtin';
import type { AmberManifest, LoadWarning, Theme, ThemeManifest } from '$lib/types/schema';
import type { Logger } from '$lib/server/logger';
import type { SpaceConfig } from './config';

export type TemplateKind = 'chrome' | 'page' | 'error';
const TEMPLATE_FILES: Record<TemplateKind, string> = {
	chrome: 'chrome.html',
	page: 'page.html',
	error: 'error.html'
};

/**
 * Scan a directory that IS the themes container (i.e. immediate subdirs are
 * theme dirs). This is the inner half of `discoverThemes` exposed so the
 * install-level shared-themes discovery can call it directly — the bundled
 * themes dir is itself the container, not a space root that contains a
 * `themes/` subdir.
 */
export function discoverThemesInDir(themesDir: string, log: Logger): Map<string, Theme> {
	const themes = new Map<string, Theme>();
	let entries: import('node:fs').Dirent[];
	try {
		entries = readdirSync(themesDir, { withFileTypes: true });
	} catch {
		return themes; // directory absent or unreadable — fine.
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

		let hasScript = false;
		try {
			hasScript = statSync(join(dir, 'theme.js')).isFile();
		} catch {
			// optional file — absence is normal, no warning (hasScript stays false)
		}

		themes.set(name, { name, path: dir, assetBase: `/themes/${name}`, manifest, hasScript });
	}
	return themes;
}

export function discoverThemes(root: string, log: Logger): Map<string, Theme> {
	return discoverThemesInDir(join(root, 'themes'), log);
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

/**
 * A cache-busting version token for one of a theme's on-disk asset files
 * (`theme.css`, `theme.js`). The token is the file's `mtimeMs` in base-36 —
 * it changes whenever the bytes change (an in-place edit, a `git pull`
 * checkout, an image rebuild), which is exactly what a `?v=` query param on
 * the asset URL needs so a browser holding a long-lived cache entry refetches.
 *
 * Returns `'0'` for the built-in theme (`path === ''`, no on-disk file) and
 * when the stat fails (file absent / unreadable) — a stable sentinel so the
 * URL is still well-formed; the asset route would 404 such a request anyway.
 *
 * One `stat` per page load is cheap (the active theme's `theme.css` and, if
 * present, `theme.js`). Discovery doesn't watch `themes/`, so reading the
 * mtime fresh at request time — rather than caching it at discovery — is what
 * makes an in-place theme edit visible without a restart.
 */
export function themeAssetVersion(theme: Theme, file: string): string {
	if (theme.path === '') return '0';
	try {
		return Math.floor(statSync(join(theme.path, file)).mtimeMs).toString(36);
	} catch {
		return '0';
	}
}

export type PartialKind = 'index';
const PARTIAL_FILES: Record<PartialKind, string> = {
	index: 'partials/index.html'
};

/**
 * Read a theme's partial template. Partials are *optional* — discovery doesn't
 * stat them — so if the active theme ships no `partials/<kind>.html` (or the
 * read fails for any reason) we fall back to `BUILTIN_PARTIALS[kind]`. The
 * built-in theme (`path === ''`) always uses the built-in partial. This is the
 * counterpart to `readTemplate`, which 500s on a missing *required* template.
 */
export function readPartial(theme: Theme, kind: PartialKind = 'index'): string {
	if (theme.path === '') return BUILTIN_PARTIALS[kind];
	try {
		return readFileSync(join(theme.path, PARTIAL_FILES[kind]), 'utf8');
	} catch {
		return BUILTIN_PARTIALS[kind];
	}
}

/** The directory name `theme = "..."` defaults to and falls back to. */
export const DEFAULT_THEME_NAME = 'amber-default';

/**
 * Merge the install-level shared theme set with a space's own discovered
 * themes into the *effective* map the resolver, picker, and asset route all
 * read. Per-space entries overwrite shared ones on name collision (a space may
 * override a shared theme by shipping its own `themes/<name>/`). Pure — the
 * shared map is always passed in, never imported, so `lib/space/` stays free of
 * server globals.
 */
export function effectiveThemes(
	shared: Map<string, Theme>,
	perSpace: Map<string, Theme>
): Map<string, Theme> {
	return new Map([...shared, ...perSpace]);
}

/**
 * Pick the active theme via the per-space resolution chain:
 *
 *   1. `spaceConfig.theme` if set and a discovered theme.
 *   2. `manifest.theme` (bare string or `{ name }`) if set and a discovered theme.
 *   3. `amber-default` if discovered.
 *   4. `BUILTIN_THEME` (the in-app floor).
 *
 * Steps 1 and 2 emit a `space_theme_not_found` LoadWarning when they name a
 * missing theme; the chain still falls through. Steps 3 and 4 are silent
 * fallbacks (the built-in floor is logged via `log.error` for visibility but
 * doesn't surface a structured warning — that pre-v0.3 P1 behavior is
 * preserved).
 *
 * Never returns null.
 */
export function resolveActiveTheme(
	themes: Map<string, Theme>,
	manifest: AmberManifest,
	spaceConfig: SpaceConfig | null,
	log: Logger
): { theme: Theme; warnings: LoadWarning[] } {
	const warnings: LoadWarning[] = [];

	// Step 1: space.toml
	if (spaceConfig?.theme !== undefined) {
		const hit = themes.get(spaceConfig.theme);
		if (hit) return { theme: hit, warnings };
		warnings.push({
			code: 'space_theme_not_found',
			message: `space.toml theme "${spaceConfig.theme}" not found under themes/; falling through`,
			source: 'space.toml'
		});
	}

	// Step 2: amber.toml
	const configured =
		typeof manifest.theme === 'string'
			? manifest.theme
			: manifest.theme && typeof manifest.theme === 'object'
				? manifest.theme.name
				: undefined;
	if (configured !== undefined) {
		const hit = themes.get(configured);
		if (hit) return { theme: hit, warnings };
		warnings.push({
			code: 'space_theme_not_found',
			message: `amber.toml theme "${configured}" not found under themes/; falling through`,
			source: 'amber.toml'
		});
	}

	// Step 3: amber-default
	const fallback = themes.get(DEFAULT_THEME_NAME);
	if (fallback) return { theme: fallback, warnings };

	// Step 4: built-in floor
	log.error(
		{ available: [...themes.keys()] },
		`no usable "${DEFAULT_THEME_NAME}" theme found under themes/; using the built-in fallback theme`
	);
	return { theme: BUILTIN_THEME, warnings };
}

export interface ThemeSourceDescription {
	/**
	 * `'space-toml'` — the rendering theme is the one this space's `space.toml`
	 * declares. `'inherited'` — no usable space-level override, so the resolver
	 * fell through to `amber.toml` / `amber-default` / the built-in floor.
	 */
	source: 'space-toml' | 'inherited';
	/**
	 * Set to the declared theme name when `space.toml` names a theme that isn't
	 * a discovered directory (the chain fell through). `null` otherwise.
	 */
	staleThemeName: string | null;
}

/**
 * Classify where the active theme came from, for the picker's
 * "Currently rendering" line and "Selected" chip. Pure — no warnings, no
 * resolution re-run (that would re-emit `space_theme_not_found`).
 *
 * Deliberately does NOT distinguish "inherited from `amber.toml`'s `theme`"
 * from "inherited from the `amber-default` floor": both read as `'inherited'`,
 * and the resolved theme *name* (held separately by the caller) already tells
 * the operator what they'll get. This is the deliberate alternative to
 * widening `resolveActiveTheme`'s return contract (spec §3).
 */
export function describeThemeSource(
	declaredTheme: string | undefined,
	discovered: Map<string, Theme>
): ThemeSourceDescription {
	if (declaredTheme !== undefined) {
		if (discovered.has(declaredTheme)) return { source: 'space-toml', staleThemeName: null };
		return { source: 'inherited', staleThemeName: declaredTheme };
	}
	return { source: 'inherited', staleThemeName: null };
}
