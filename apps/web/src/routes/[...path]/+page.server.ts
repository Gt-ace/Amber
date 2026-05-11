/**
 * Catch-all page handler. Resolves the request URL through the Space,
 * renders the matched page's markdown to HTML (cached by content hash), then
 * renders the active theme's page template around it and returns that as
 * `bodyHtml` for `+page.svelte` to inject.
 *
 * Drafts: the loader keeps drafts in `space.pages` (see CLAUDE.md → "Drafts");
 * the handler decides exposure. Production: drafts return 404. Dev: drafts
 * render with a banner (the theme template's `{{#is_draft}}` block).
 */

import { error, redirect } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { getSpace } from '$lib/server/space';
import { getOrRenderHtml, bodyHash } from '$lib/render/cache';
import { renderTemplate } from '$lib/render/template';
import { readTemplate } from '$lib/space/themes';
import { readSiteUrl } from '$lib/server/sitemap';
import type { PageServerLoad } from './$types';

/**
 * Format a frontmatter `date` (ISO 8601 string) for display: long month, in
 * UTC with a pinned locale so a bare `date: 2026-04-22` (stored as midnight
 * UTC) doesn't slip a day in the reader's timezone and SSR/CSR agree. Returns
 * '' for missing or unparseable values (the page template hides the date block
 * when it's empty). This moved out of `+page.svelte` — themes get a clean
 * pre-formatted string, not the raw frontmatter value (SPIKE_NOTES).
 */
function formatDisplayDate(raw: string | undefined): string {
	if (!raw) return '';
	const parsed = new Date(raw);
	if (Number.isNaN(parsed.getTime())) return '';
	return parsed.toLocaleDateString('en-US', {
		timeZone: 'UTC',
		year: 'numeric',
		month: 'long',
		day: 'numeric'
	});
}

export const load: PageServerLoad = ({ params }) => {
	const space = getSpace();

	const raw = params.path ?? '';
	const url = raw === '' ? '/' : '/' + raw.replace(/\/+$/, '');

	const target = space.redirects.get(url);
	if (target !== undefined && target !== url) {
		redirect(308, target);
	}

	const page = space.pages.get(url);
	if (!page) error(404, `No page at ${url}`);
	if (page.frontmatter.draft && !dev) error(404, `No page at ${url}`);

	const html = getOrRenderHtml(space, page);
	const isDraft = page.frontmatter.draft === true;
	const title = page.frontmatter.title ?? '';
	const dateIso = page.frontmatter.date ?? '';
	const dateDisplay = formatDisplayDate(page.frontmatter.date);

	// Render the active theme's page template, reading it from disk at request
	// time and caching the rendered output through the same render-cache table
	// the markdown renderer uses (`getOrRenderHtml`). Key = sha256 over the
	// template bytes + the substitution data (which already contains the
	// body-hash-cached `html`), prefixed so it can't be confused with a bare
	// body-hash row. Note: `vacuumRenderCache()` (cold-start only) clears these
	// rows since their key isn't a current page body hash — cheap to refill.
	const pageTpl = readTemplate(space.theme, 'page');
	const pageData = {
		is_draft: isDraft && dev, // the banner is dev-only; in prod drafts already 404
		has_header: Boolean(title || dateDisplay),
		title,
		date_iso: dateIso,
		date_display: dateDisplay,
		html
	};
	const cacheKey = bodyHash('page-template\n' + pageTpl + '\n' + JSON.stringify(pageData));
	let bodyHtml = space.getCachedRender(cacheKey);
	if (bodyHtml === null) {
		bodyHtml = renderTemplate(pageTpl, pageData);
		space.putCachedRender(cacheKey, bodyHtml);
	}

	return {
		page: {
			url: page.url,
			frontmatter: page.frontmatter,
			html,
			isDraft
		},
		bodyHtml,
		site: space.manifest.site ?? null,
		siteUrl: readSiteUrl()
	};
};
