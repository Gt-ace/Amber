/**
 * Root layout server load.
 *
 * Produces the page chrome data shared across every route: the public nav
 * (a flat list of `{ label, href }` links, straight from the validated
 * manifest — the v0.2 nav schema is opaque to the loader, so there's no
 * draft filtering to do here) and the site block from the manifest.
 *
 * Also surfaces an optional `/404` page from the space. If `404.md` exists at
 * the space root and is not a draft, its rendered HTML is exposed as
 * `notFoundHtml` so `+error.svelte` can render it inside the same chrome.
 * When absent, `notFoundHtml` is `null` and `+error.svelte` falls back to a
 * built-in message.
 */

import { getSpace } from '$lib/server/space';
import { getOrRenderHtml } from '$lib/render/cache';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const space = getSpace();

	const nav = space.nav;
	const site = space.manifest.site ?? null;

	// Optional `/404` page. Drafts are excluded — surprising behavior to
	// have a draft `404.md` quietly take over error rendering.
	const notFoundPage = space.pages.get('/404');
	const notFoundHtml =
		notFoundPage && notFoundPage.frontmatter.draft !== true
			? getOrRenderHtml(space, notFoundPage)
			: null;

	return { nav, site, notFoundHtml };
};
