/**
 * Root layout server load.
 *
 * Produces the page chrome data shared across every route: the public nav
 * (drafts filtered out — see CLAUDE.md → "Drafts": loader produces, consumers
 * decide) and the site block from the manifest.
 *
 * Also surfaces an optional `/404` page from the space. If `404.md` exists at
 * the space root and is not a draft, its rendered HTML is exposed as
 * `notFoundHtml` so `+error.svelte` can render it inside the same chrome.
 * When absent, `notFoundHtml` is `null` and `+error.svelte` falls back to a
 * built-in message.
 */

import { getSpace } from '$lib/server/space';
import { getOrRenderHtml } from '$lib/render/cache';
import type { ResolvedNavEntry } from '$lib/types/schema';
import type { LayoutServerLoad } from './$types';

/**
 * Filter drafts out of a `ResolvedNavEntry[]` tree. `page` entries carry their
 * `Page` directly (so we read `frontmatter.draft` from the entry); `external`
 * entries pass through unchanged; `group` entries recurse and keep the group
 * even if every child was a draft (nav structure is part of the author's
 * intent — an empty group surfaces as a label with no items, which the layout
 * happens to render harmlessly).
 */
export function _filterDraftsFromNav(entries: ResolvedNavEntry[]): ResolvedNavEntry[] {
	const out: ResolvedNavEntry[] = [];
	for (const entry of entries) {
		if (entry.kind === 'page') {
			if (entry.page.frontmatter.draft === true) continue;
			out.push(entry);
		} else if (entry.kind === 'external') {
			out.push(entry);
		} else {
			// group
			out.push({
				kind: 'group',
				label: entry.label,
				children: _filterDraftsFromNav(entry.children)
			});
		}
	}
	return out;
}

export const load: LayoutServerLoad = () => {
	const space = getSpace();

	const nav = _filterDraftsFromNav(space.nav);
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
