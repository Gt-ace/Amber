/**
 * Sitemap helpers: env-var read, warn-on-unset, and the pure XML builder.
 *
 * Lives under `lib/server/` so the route file `routes/sitemap.xml/+server.ts`
 * stays a thin SvelteKit handler. SvelteKit rejects non-prefixed exports from
 * `+server.ts`, so the tests need a non-route home for these helpers anyway.
 *
 * Drafts: the loader keeps drafts in `Space.pages`; `buildSitemapXml` is the
 * consumer that filters them out. ("Loader produces, consumers decide.")
 */

import { logger } from './logger';
import type { Page } from '$lib/types/schema';

const log = logger.child({ subsystem: 'sitemap' });

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
 * stay quiet.
 */
export function readSiteUrlOrWarn(): string | null {
	const value = readSiteUrl();
	if (value === null) {
		log.warn(
			'PUBLIC_SITE_URL is not set; sitemap.xml will use relative URLs. ' +
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
 *   `${siteUrl}${page.url}` with the root URL `/` collapsing to `${siteUrl}/`.
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
	return siteUrl + pageUrl;
}

function formatLastmod(mtimeMs: number): string | null {
	if (!Number.isFinite(mtimeMs) || mtimeMs <= 0) return null;
	const d = new Date(mtimeMs);
	if (Number.isNaN(d.getTime())) return null;
	return d.toISOString().slice(0, 10);
}

function escapeXml(value: string): string {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
