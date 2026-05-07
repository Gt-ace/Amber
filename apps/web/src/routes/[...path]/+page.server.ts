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

import { error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getSpace } from '$lib/server/space';
import { getOrRenderHtml } from '$lib/render/cache';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params }) => {
	const space = getSpace();

	// `[...path]` gives us `params.path` as a slash-joined string with no
	// leading slash. Empty string means the root URL "/". Normalize to the
	// canonical form `space.pages` uses: leading slash, no trailing slash,
	// "/" for the root.
	const raw = params.path ?? '';
	const url = raw === '' ? '/' : '/' + raw.replace(/\/+$/, '');

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
		nav: space.nav,
		site: space.manifest.site ?? null
	};
};
