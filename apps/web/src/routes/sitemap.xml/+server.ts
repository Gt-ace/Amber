/**
 * sitemap.xml — generated from the live Space, drafts filtered out.
 *
 * The XML is hand-rolled (the schema is small; a dep would be overkill).
 * The XML build is factored into the pure helper `buildSitemapXml()` so
 * tests don't have to mock the SvelteKit handler or env layer.
 *
 * Drafts: `space.pages` includes drafts by design (see CLAUDE.md → "Drafts").
 * The sitemap is a *consumer*; it filters at the call site, never at the loader.
 *
 * Site URL: read from `PUBLIC_SITE_URL` env var. When unset, we log a warning
 * and emit relative URLs — the file is still useful to a human reader, but
 * search engines won't accept it. Better than throwing on a missing env var
 * during a normal dev run.
 */

import type { RequestHandler } from './$types';
import { getSpace } from '$lib/server/space';
import type { Page } from '$lib/types/schema';

export const GET: RequestHandler = () => {
	const space = getSpace();
	const siteUrl = readSiteUrlOrWarn();
	const xml = buildSitemapXml(space.pages.values(), siteUrl);
	return new Response(xml, {
		headers: { 'Content-Type': 'application/xml' }
	});
};

/**
 * Read `PUBLIC_SITE_URL` from the environment, stripping a trailing slash if
 * present so callers can concatenate `siteUrl + page.url` without producing
 * a double-slash. Returns `null` when unset or empty.
 */
export function readSiteUrl(): string | null {
	const raw = process.env.PUBLIC_SITE_URL;
	if (!raw) return null;
	const trimmed = raw.trim();
	if (!trimmed) return null;
	return trimmed.replace(/\/+$/, '');
}

/**
 * Same as `readSiteUrl()`, but logs a one-line warning when the env var is
 * unset. Used by the request-time handlers; tests of `readSiteUrl()` itself
 * stay quiet. (Task 1 will swap `console.warn` for the structured logger.)
 */
export function readSiteUrlOrWarn(): string | null {
	const value = readSiteUrl();
	if (value === null) {
		console.warn(
			'[amber] PUBLIC_SITE_URL is not set; sitemap.xml will use relative URLs. ' +
				'Set PUBLIC_SITE_URL=https://your-site.example to emit absolute URLs.'
		);
	}
	return value;
}

/**
 * Build a sitemap XML document. Pure: takes pages (already-loaded `Page`
 * objects) and a base URL, returns a string. Filters drafts.
 *
 * - `siteUrl` should already be sanitized (no trailing slash). When `null`,
 *   `<loc>` is the page URL alone (e.g. `/about`); when set, it's
 *   `${siteUrl}${page.url}` with the root URL `/` collapsing to `siteUrl`.
 * - `<lastmod>` is the page's mtime as `YYYY-MM-DD`.
 */
export function buildSitemapXml(pages: Iterable<Page>, siteUrl: string | null): string {
	const lines: string[] = [];
	lines.push('<?xml version="1.0" encoding="UTF-8"?>');
	lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');

	for (const page of pages) {
		if (page.frontmatter.draft === true) continue;

		const loc = formatLoc(page.url, siteUrl);
		const lastmod = formatLastmod(page.mtime);
		lines.push('\t<url>');
		lines.push(`\t\t<loc>${escapeXml(loc)}</loc>`);
		if (lastmod) lines.push(`\t\t<lastmod>${lastmod}</lastmod>`);
		lines.push('\t</url>');
	}

	lines.push('</urlset>');
	return lines.join('\n') + '\n';
}

function formatLoc(pageUrl: string, siteUrl: string | null): string {
	if (siteUrl === null) return pageUrl;
	// `pageUrl` is canonical: leading slash, "/" for root.
	// Concatenating `siteUrl` (no trailing slash) + `/about` yields
	// `https://x.example/about`. For the root URL we keep `${siteUrl}/`
	// rather than emitting a bare `${siteUrl}` — both are valid but the
	// trailing slash matches what a browser would request.
	return siteUrl + pageUrl;
}

function formatLastmod(mtimeMs: number): string | null {
	if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return null;
	const d = new Date(mtimeMs);
	if (Number.isNaN(d.getTime())) return null;
	// ISO date part only — `<lastmod>` accepts full ISO 8601 but the date
	// granularity is what people actually publish.
	return d.toISOString().slice(0, 10);
}

function escapeXml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
