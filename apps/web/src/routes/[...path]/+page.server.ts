/**
 * Catch-all page handler. Resolves the request URL through the Space,
 * renders the matched page's markdown to HTML (cached by content hash),
 * and returns frontmatter + HTML for the component to display.
 *
 * Drafts: the loader keeps drafts in `space.pages` (see CLAUDE.md →
 * "Drafts"); the handler is the consumer that decides what to expose.
 *   - Production: drafts return 404. The URL behaves as if the page does
 *     not exist.
 *   - Dev: drafts render with a banner. This lets authors preview without
 *     publishing, without leaking through to production.
 */

import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getSpace } from '$lib/server/space';
import { getOrRenderHtml } from '$lib/render/cache';
import { readSiteUrl } from '$lib/server/sitemap';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const space = getSpace();

	// `[...path]` gives us `params.path` as a slash-joined string with no
	// leading slash. Empty string means the root URL "/". Normalize to the
	// canonical form `space.pages` uses: leading slash, no trailing slash,
	// "/" for the root.
	const raw = params.path ?? '';
	const url = raw === '' ? '/' : '/' + raw.replace(/\/+$/, '');

	// Redirect check runs before the page lookup so old URLs win even if a new
	// page happens to have a colliding URL — the loader already prefers the
	// live page when there's a collision (see `Space.load`'s eviction step),
	// so reaching this branch implies the source URL is genuinely abandoned.
	// Single-hop only: the target may itself be a redirect, but we don't
	// chase chains here.
	const target = space.redirects.get(url);
	if (target !== undefined && target !== url) {
		redirect(308, target);
	}

	const page = space.pages.get(url);
	if (!page) error(404, `No page at ${url}`);

	if (page.frontmatter.draft && !dev) error(404, `No page at ${url}`);

	const html = getOrRenderHtml(space, page);

	return {
		page: {
			url: page.url,
			frontmatter: page.frontmatter,
			html,
			isDraft: page.frontmatter.draft === true
		},
		// `site` is read by `<svelte:head>` for the `<title>` suffix. The
		// nav/site chrome lives in the layout (see `+layout.server.ts`); this
		// is a redundant convenience for the page-specific head block, not a
		// data duplication of the layout's responsibility.
		site: space.manifest.site ?? null,
		// `siteUrl` powers absolute og:url and rel=canonical. Null when
		// `PUBLIC_SITE_URL` is unset; the component falls back to the page
		// path alone in that case.
		siteUrl: readSiteUrl()
	};
};
