/**
 * Catch-all page handler. Resolves the request URL through the Space, then
 * delegates the body render (markdown → HTML, optional auto-index partial,
 * theme `page.html` wrapper — all cached) to `renderPageBody`, and returns
 * `bodyHtml` for `+page.svelte` to inject.
 *
 * Drafts: the loader keeps drafts in `space.pages` (see CLAUDE.md → "Drafts");
 * the handler decides exposure. Production: drafts return 404. Dev: drafts
 * render with a banner (the page template's `{{#is_draft}}` block).
 */

import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { renderPageBody } from '$lib/render/page';
import { readSiteUrl } from '$lib/server/sitemap';
import { isAuthor } from '$lib/server/auth';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = (event) => {
	const { params } = event;
	const space = event.locals.space;
	if (!space) error(404, 'No space matched');

	const raw = params.path ?? '';
	const url = raw === '' ? '/' : '/' + raw.replace(/\/+$/, '');

	const target = space.redirects.get(url);
	if (target !== undefined && target !== url) {
		redirect(308, target);
	}

	const page = space.pages.get(url);
	if (!page) error(404, `No page at ${url}`);
	if (page.frontmatter.draft && !dev) error(404, `No page at ${url}`);

	const { html, bodyHtml } = renderPageBody(space, page, { dev });

	// Authenticated requests get a server-emitted edit link — a plain href,
	// no page content crosses to the client as data. `url` is the canonical
	// page URL already resolved above; `/` maps to `/admin/edit`.
	const editHref = isAuthor(event) ? `/admin/edit${url === '/' ? '' : url}` : null;

	return {
		page: {
			url: page.url,
			frontmatter: page.frontmatter,
			html,
			isDraft: page.frontmatter.draft === true
		},
		bodyHtml,
		site: space.manifest.site ?? null,
		siteUrl: readSiteUrl(),
		editHref
	};
};
