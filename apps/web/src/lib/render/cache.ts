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
import type { Space } from '$lib/space/space';
import type { Page } from '$lib/types/schema';

export function bodyHash(body: string): string {
	return createHash('sha256').update(body).digest('hex');
}

/**
 * sha256 of a template's source bytes. Functionally identical to `bodyHash` —
 * the separate name keeps call sites that mean "this is a template hash"
 * readable, and `pageRenderCacheKey` folds one of these in explicitly so a
 * theme template edit invalidates the cached page render.
 */
export function templateHash(source: string): string {
	return createHash('sha256').update(source).digest('hex');
}

/**
 * Cache key for a rendered *page template* output (the `page.html` render, not
 * the markdown render). Folds in, explicitly: the template hash, the rendered
 * body-HTML hash, the rendered auto-index-partial HTML hash, and the small
 * scalar substitution data. Any of those changing invalidates the row. The
 * `'page-template'` prefix keeps it disjoint from bare body-hash render rows
 * (those are `bodyHash(page.body)`); `vacuumRenderCache()` at cold start drops
 * these prefixed rows since their key isn't a current page body hash — cheap to
 * refill.
 */
export function pageRenderCacheKey(parts: {
	templateSource: string;
	bodyHtml: string;
	indexHtml: string;
	data: Record<string, unknown>;
}): string {
	return createHash('sha256')
		.update('page-template\n')
		.update(templateHash(parts.templateSource))
		.update('\n')
		.update(bodyHash(parts.bodyHtml))
		.update('\n')
		.update(bodyHash(parts.indexHtml))
		.update('\n')
		.update(JSON.stringify(parts.data))
		.digest('hex');
}

/**
 * Cache key for a rendered auto-index *partial* output: the partial template's
 * hash plus a stable serialization of the entries it was given. `JSON.stringify`
 * is stable here because `resolveAutoIndexEntries` builds each entry object with
 * a fixed key order. Same `vacuum` caveat as `pageRenderCacheKey`.
 */
export function partialRenderCacheKey(partialSource: string, entries: unknown[]): string {
	return createHash('sha256')
		.update('partial-index\n')
		.update(templateHash(partialSource))
		.update('\n')
		.update(JSON.stringify(entries))
		.digest('hex');
}

export function getOrRenderHtml(space: Space, page: Page): string {
	const hash = bodyHash(page.body);
	const cached = space.getCachedRender(hash);
	if (cached !== null) return cached;
	const html = render(page.body);
	space.putCachedRender(hash, html);
	return html;
}
