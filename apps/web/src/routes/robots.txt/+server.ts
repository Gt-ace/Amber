/**
 * robots.txt — minimal, allow-all, with a Sitemap pointer when we know the
 * absolute URL. Without `PUBLIC_SITE_URL` we omit the Sitemap line rather
 * than emitting a relative one (relative sitemap URLs in robots.txt aren't
 * widely supported and we'd rather omit the line than mislead crawlers).
 */

import type { RequestHandler } from './$types';
import { readSiteUrl } from '../sitemap.xml/+server';

export const GET: RequestHandler = () => {
	const siteUrl = readSiteUrl();
	const lines = ['User-agent: *', 'Allow: /'];
	if (siteUrl) lines.push(`Sitemap: ${siteUrl}/sitemap.xml`);
	const body = lines.join('\n') + '\n';
	return new Response(body, {
		headers: { 'Content-Type': 'text/plain' }
	});
};
