/**
 * Render cache wrapper.
 *
 * `getOrRenderHtml(space, page)` is the entry point the page handler calls.
 * It hashes the page body (sha256), checks the SQLite `renders` table via
 * the Space's existing cache connection, and either returns the cached HTML
 * or renders + persists.
 *
 * The hash is over `page.body` alone — *not* the full file contents and *not*
 * the URL. Two pages with identical bodies but different frontmatter share a
 * cache row. This is intentional: the renderer is a function of body bytes,
 * so the cache key should be too.
 *
 * `Page.contentHash` is sha256 of the *full file* (frontmatter + body), so
 * we can't reuse it here. We compute a separate body-only hash inline.
 */

import { createHash } from 'node:crypto';
import { render } from './render.ts';
import type { Space } from '$lib/space/space.ts';
import type { Page } from '$lib/types/schema';

export function bodyHash(body: string): string {
	return createHash('sha256').update(body).digest('hex');
}

export function getOrRenderHtml(space: Space, page: Page): string {
	const hash = bodyHash(page.body);
	const cached = space.getCachedRender(hash);
	if (cached !== null) return cached;
	const html = render(page.body);
	space.putCachedRender(hash, html);
	return html;
}
