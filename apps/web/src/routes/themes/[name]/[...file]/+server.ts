/**
 * Static asset handler for theme files: `/themes/<name>/<path>` maps to
 * `<spaceRoot>/themes/<name>/<path>` on disk. Covers `theme.css` and anything
 * under a theme's optional `fonts/` directory.
 *
 * Why a route and not SvelteKit's `static/` dir: themes live in the *space*
 * directory (the bind-mounted, user-owned content tree), not the app bundle —
 * they aren't known at build time. Caddy proxies everything to this Node
 * server anyway (see Caddyfile), so a `+server.ts` is the idiomatic fit, same
 * as `robots.txt` / `sitemap.xml`.
 *
 * Path-traversal guard: the resolved target must stay inside
 * `<spaceRoot>/themes/<name>/`. Anything that escapes → 404 (not 403; we don't
 * want to confirm the file exists elsewhere).
 *
 * Cache policy: `public, max-age=3600`. There's no prior disk-served-asset
 * policy in the repo to match; this is a modest default. Theme files are
 * effectively immutable per deploy (the image is rebuilt, the container
 * restarts) but they don't carry content-hashed names, so `immutable` /
 * year-long max-age would be wrong.
 */

import { readFileSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { getSpace } from '$lib/server/space';
import type { RequestHandler } from './$types';

const CONTENT_TYPES: Record<string, string> = {
	'.css': 'text/css; charset=utf-8',
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

export const GET: RequestHandler = ({ params }) => {
	const name = params.name ?? '';
	const file = params.file ?? '';
	if (!name || !file) return NOT_FOUND();

	const space = getSpace();
	const themeRoot = resolve(space.root, 'themes', name);
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
	return new Response(data, {
		headers: {
			'content-type': contentType,
			'cache-control': 'public, max-age=3600'
		}
	});
};
