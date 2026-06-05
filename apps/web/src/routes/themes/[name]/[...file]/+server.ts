/**
 * Static asset handler for theme files: `/themes/<name>/<path>` serves from
 * `<spaceRoot>/themes/<name>/<path>` (the space's own theme) or, as a fallback,
 * the install-level shared themes dir `<sharedThemesDir()>/<name>/<path>` — see
 * the directory-precedence comment inside `GET`. Covers `theme.css` and
 * anything under a theme's optional `fonts/` directory.
 *
 * Why a route and not SvelteKit's `static/` dir: per-space themes live in the
 * *space* directory (the bind-mounted, user-owned content tree), and the shared
 * set ships with the app outside `static/`; neither is known at build time as a
 * public asset. Caddy proxies everything to this Node server anyway (see
 * Caddyfile), so a `+server.ts` is the idiomatic fit, same as `robots.txt` /
 * `sitemap.xml`.
 *
 * Path-traversal guard: the resolved target must stay strictly inside whichever
 * `themes/<name>/` root was selected (per-space or shared). Anything that
 * escapes → 404 (not 403; we don't want to confirm the file exists elsewhere).
 *
 * Cache policy: a request carrying a `?v=` version token (added by the layout
 * to `theme.css` / `theme.js` URLs — the token is the file's mtime, so the URL
 * changes whenever the bytes do) is served `public, max-age=31536000,
 * immutable`: the URL is now content-versioned, so caching it forever is both
 * correct and fast. A bare, un-versioned request (a direct hit, or a
 * `@font-face` URL inside a theme's CSS that we don't version) keeps the modest
 * `public, max-age=3600` — short enough that an un-versioned theme edit can't
 * go stale for long.
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import type { RequestHandler } from './$types';
import { sharedThemesDir } from '$lib/server/shared-themes';

const CONTENT_TYPES: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.mjs': 'text/javascript; charset=utf-8',
	'.map': 'application/json; charset=utf-8',
	'.woff2': 'font/woff2',
	'.woff': 'font/woff',
	'.ttf': 'font/ttf',
	'.otf': 'font/otf',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
	'.ico': 'image/x-icon'
};

const NOT_FOUND = () => new Response('Not found', { status: 404 });

function isDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

export const GET: RequestHandler = ({ params, locals, url }) => {
	const name = params.name ?? '';
	const file = params.file ?? '';
	if (!name || !file) return NOT_FOUND();
	// `name` is a single path segment. `.`/`..` or an embedded slash would let
	// `themeRoot` resolve to or above `<spaceRoot>/themes/` — unreachable via
	// SvelteKit's normalized routing, but cheap insurance: the `target` check
	// below only verifies `target` is under `themeRoot`, not `themeRoot` itself.
	if (name.includes('/') || name === '.' || name === '..') return NOT_FOUND();

	const space = locals.space;
	if (!space) return NOT_FOUND();

	// Directory precedence (spec §7): serve from the space's own `themes/<name>/`
	// if that directory exists, else from the install-level shared themes dir.
	// Per-space wins on name collision; we never mix assets across the two roots.
	// Deliberately independent of theme *discovery* — an incomplete theme dir
	// (e.g. css-only, missing templates) still serves its assets.
	const perSpaceRoot = resolve(space.root, 'themes', name);
	const sharedRoot = resolve(sharedThemesDir(), name);
	let themeRoot: string | null = null;
	if (isDir(perSpaceRoot)) themeRoot = perSpaceRoot;
	else if (isDir(sharedRoot)) themeRoot = sharedRoot;
	if (!themeRoot) return NOT_FOUND();

	const target = resolve(themeRoot, file);

	// Containment check: `target` must be strictly below `themeRoot`.
	// If it equals themeRoot (a directory) or escapes via `../`, return 404.
	if (!target.startsWith(themeRoot + sep)) {
		return NOT_FOUND();
	}

	let data: ArrayBuffer;
	try {
		const st = statSync(target);
		if (!st.isFile()) return NOT_FOUND();
		const buf = readFileSync(target);
		data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
	} catch {
		return NOT_FOUND();
	}

	const contentType = CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream';
	const cacheControl = url.searchParams.has('v')
		? 'public, max-age=31536000, immutable'
		: 'public, max-age=3600';
	return new Response(data, {
		headers: {
			'content-type': contentType,
			'cache-control': cacheControl
		}
	});
};
