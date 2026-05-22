/**
 * 308 shim — preserves the PUT method. Subsystem-2 clients posting saves
 * to the old URL get rerouted to /admin/spaces/[default]/api/page/[...]
 * preserving the request body. May be removed in v0.6.
 */

import path from 'node:path';
import { getRegistryEntries } from '$lib/server/space';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = ({ params, url }) => {
	const entries = getRegistryEntries();
	if (entries.length === 0) return new Response('No spaces loaded', { status: 404 });
	const defaultSlug = path.basename(entries[0].path);
	const target = `/admin/spaces/${defaultSlug}/api/page/${params.path}${url.search}`;
	return new Response(null, { status: 308, headers: { location: target } });
};
