/**
 * sitemap.xml — generated from the live Space, drafts filtered out.
 *
 * Thin handler: helpers (`readSiteUrl`, `readSiteUrlOrWarn`, `buildSitemapXml`)
 * live in `$lib/server/sitemap` so SvelteKit's `+server.ts` export validation
 * stays satisfied and the helpers are unit-testable without mocking the
 * SvelteKit handler.
 */

import type { RequestHandler } from './$types';
import { buildSitemapXml, readSiteUrlOrWarn } from '$lib/server/sitemap';

export const GET: RequestHandler = ({ locals }) => {
	const space = locals.space;
	if (!space) return new Response('Not Found', { status: 404 });
	const siteUrl = readSiteUrlOrWarn();
	const xml = buildSitemapXml(space.pages.values(), siteUrl, locals.mountPrefix ?? '');
	return new Response(xml, {
		headers: { 'Content-Type': 'application/xml' }
	});
};
