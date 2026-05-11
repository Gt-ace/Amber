/**
 * Root layout server load.
 *
 * Produces the page chrome by rendering the active theme's `chrome.html`
 * template (site title, nav, footer slot — none of which vary per page) and
 * splitting it at the `CONTENT_SLOT` marker into `chromeBefore` / `chromeAfter`,
 * which `+layout.svelte` `{@html}`s around `{@render children()}`. So the
 * chrome persists across client-side navigation and only the content swaps.
 *
 * Chrome is read from disk and re-rendered each request but *not* SQLite-cached:
 * its inputs are constant per run and the output is a few hundred bytes — a
 * hash + cache roundtrip would cost more than the substitution. (The page
 * template render *is* cached — see `+page.server.ts`.)
 *
 * Also surfaces: the theme's CSS URL and `theme-color` values for `<svelte:head>`,
 * the raw `error.html` template (`+error.svelte` renders it itself — it needs
 * `page.status` / `page.error`, which only exist there), and the optional
 * `/404` page's rendered HTML (drafts excluded — a draft `404.md` quietly
 * taking over error rendering would be surprising).
 *
 * `nav` and `site` are still returned for any consumer that wants the raw data;
 * the chrome itself is built here from them.
 */

import { getSpace } from '$lib/server/space';
import { getOrRenderHtml } from '$lib/render/cache';
import { renderTemplate, CONTENT_SLOT } from '$lib/render/template';
import { readTemplate } from '$lib/space/themes';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = () => {
	const space = getSpace();
	const theme = space.theme;

	const nav = space.nav;
	const site = space.manifest.site ?? null;

	const footer = theme.manifest.footer ?? {};
	// The chrome template contains `CONTENT_SLOT` (`<!--amber:content-->`)
	// verbatim — we don't pass a `content` key; we render everything else, then
	// split on the marker. `{{var}}` substitution escapes `<`/`>`, so no site
	// title / nav label / footer value can forge it.
	const chromeRendered = renderTemplate(readTemplate(theme, 'chrome'), {
		site_title: site?.title ?? '',
		site_title_or_default: site?.title ?? 'Amber',
		has_nav: nav.length > 0,
		nav,
		footer_label: footer.label ?? '',
		footer_href: footer.href ?? ''
	});
	const slot = chromeRendered.indexOf(CONTENT_SLOT);
	const chromeBefore = slot === -1 ? chromeRendered : chromeRendered.slice(0, slot);
	const chromeAfter = slot === -1 ? '' : chromeRendered.slice(slot + CONTENT_SLOT.length);

	const themeColor = theme.manifest.theme_color ?? null;
	const themeCssHref = theme.assetBase ? `${theme.assetBase}/theme.css` : null;

	const notFoundPage = space.pages.get('/404');
	const notFoundHtml =
		notFoundPage && notFoundPage.frontmatter.draft !== true
			? getOrRenderHtml(space, notFoundPage)
			: null;

	return {
		nav,
		site,
		notFoundHtml,
		chromeBefore,
		chromeAfter,
		errorTemplate: readTemplate(theme, 'error'),
		themeCssHref,
		themeColor
	};
};
