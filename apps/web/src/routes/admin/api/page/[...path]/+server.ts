/**
 * 308 shim — preserves the PUT method. Subsystem-2 clients posting saves
 * to the old URL get rerouted to /admin/spaces/[default]/api/page/[...]
 * preserving the request body. Picks the space declared `default = true`
 * in `space.toml`, falling back to the first registered space. May be
 * removed in v0.6.
 *
 * The handler lives outside the `(authed)` group, so it has to call
 * `requireAuthor` itself — otherwise an unauthenticated PUT would 308 to
 * the default slug and leak install state (the configured default slug,
 * or `No spaces loaded` when zero are loaded). The downstream endpoint
 * still enforces auth — this only restores the uniform 401 the v0.4
 * handler issued before subsystem 3.
 */

import { requireAuthor } from '$lib/server/auth';
import { getDefaultSlug } from '$lib/server/default-space';
import type { RequestHandler } from './$types';

export const PUT: RequestHandler = (event) => {
	requireAuthor(event);
	const { params, url } = event;
	const defaultSlug = getDefaultSlug();
	if (!defaultSlug) return new Response('No spaces loaded', { status: 404 });
	const target = `/admin/spaces/${defaultSlug}/api/page/${params.path}${url.search}`;
	return new Response(null, { status: 308, headers: { location: target } });
};
