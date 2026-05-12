/**
 * Render a page's body for the catch-all route: markdown → HTML (cached),
 * then — if the page declares a valid `auto_index` — resolve the entries
 * against the live page set and render the active theme's `partials/index.html`
 * (cached), then render the theme's `page.html` around it (cached, with a key
 * that folds in the template hash explicitly — see `pageRenderCacheKey`).
 *
 * Why a module and not inline in `+page.server.ts`: SvelteKit route modules
 * are awkward to unit-test (their export shape is validated only at request
 * time), so the testable logic lives here; the route just calls this.
 *
 * Returns both halves: `html` is the rendered markdown body (the route still
 * exposes it as `data.page.html`); `bodyHtml` is the full `page.html` render
 * the route hands to `+page.svelte`.
 */

import { getOrRenderHtml, pageRenderCacheKey, partialRenderCacheKey } from './cache.ts';
import { renderTemplate } from './template.ts';
import { readTemplate, readPartial } from '$lib/space/themes';
import { resolveAutoIndexEntries } from '$lib/space/auto-index';
import type { Space } from '$lib/space/space';
import type { Page } from '$lib/types/schema';

/**
 * Format a frontmatter `date` (ISO 8601 string) for display: long month, in
 * UTC with a pinned locale so a bare `date: 2026-04-22` (stored as midnight
 * UTC) doesn't slip a day in the reader's timezone and SSR/CSR agree. Returns
 * '' for missing or unparseable values (the page template hides the date block
 * when it's empty).
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

export function renderPageBody(
	space: Space,
	page: Page,
	opts: { dev?: boolean } = {}
): { html: string; bodyHtml: string } {
	const dev = opts.dev ?? false;

	// Markdown body → HTML (cached by body-bytes hash; a function of the body
	// alone, so the template never enters this key).
	const html = getOrRenderHtml(space, page);

	// Auto-index: when the page declares a valid `auto_index` directive, resolve
	// the entries against the *live* page set (so it reflects watcher updates,
	// not load-time state) and render the active theme's index partial. The
	// partial output is appended below the page body — host markdown first, then
	// the list (docs/p1.md). Empty string when there's no directive.
	let indexHtml = '';
	const directive = page.frontmatter.auto_index;
	if (directive) {
		const entries = resolveAutoIndexEntries(space.pages.values(), page, directive);
		const partialSource = readPartial(space.theme, 'index');
		const key = partialRenderCacheKey(partialSource, entries);
		const cached = space.getCachedRender(key);
		if (cached !== null) {
			indexHtml = cached;
		} else {
			indexHtml = renderTemplate(partialSource, { index_entries: entries });
			space.putCachedRender(key, indexHtml);
		}
	}

	// Page template (`page.html`) around the body + index, cached.
	const templateSource = readTemplate(space.theme, 'page');
	const title = page.frontmatter.title ?? '';
	const dateIso = page.frontmatter.date ?? '';
	const dateDisplay = formatDisplayDate(page.frontmatter.date);
	const isDraft = page.frontmatter.draft === true;
	const data = {
		is_draft: isDraft && dev, // the banner is dev-only; prod drafts already 404
		has_header: Boolean(title || dateDisplay),
		title,
		date_iso: dateIso,
		date_display: dateDisplay
	};
	const key = pageRenderCacheKey({ templateSource, bodyHtml: html, indexHtml, data });
	const cached = space.getCachedRender(key);
	if (cached !== null) return { html, bodyHtml: cached };
	const bodyHtml = renderTemplate(templateSource, { ...data, html, index_html: indexHtml });
	space.putCachedRender(key, bodyHtml);
	return { html, bodyHtml };
}
