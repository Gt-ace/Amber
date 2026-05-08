/**
 * sitemap.xml — generated from the live Space, drafts filtered out.
 *
 * Thin handler: helpers (`readSiteUrl`, `readSiteUrlOrWarn`, `buildSitemapXml`)
 * live in `$lib/server/sitemap` so SvelteKit's `+server.ts` export validation
 * stays satisfied and the helpers are unit-testable without mocking the
 * SvelteKit handler.
 */

import type { RequestHandler } from './$types';
import { getSpace } from '$lib/server/space';
import { buildSitemapXml, readSiteUrlOrWarn } from '$lib/server/sitemap';

export const GET: RequestHandler = () => {
	const space = getSpace();
	const siteUrl = readSiteUrlOrWarn();
	const xml = buildSitemapXml(space.pages.values(), siteUrl);
	return new Response(xml, {
		headers: { 'Content-Type': 'application/xml' }
	});
};
