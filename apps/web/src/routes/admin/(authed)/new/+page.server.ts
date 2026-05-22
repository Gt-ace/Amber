/**
 * v0.5 subsystem 3 backward-compat shim. Redirects /admin/new (the
 * subsystem-2 URL) to /admin/spaces/[default]/new where [default] is the
 * space declared `default = true` in `space.toml`, or the first registered
 * space when no default is set. May be removed in v0.6.
 */

import { redirect } from '@sveltejs/kit';
import { getDefaultSlug } from '$lib/server/default-space';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const defaultSlug = getDefaultSlug();
	if (!defaultSlug) redirect(302, '/admin');
	redirect(302, `/admin/spaces/${defaultSlug}/new${url.search}`);
};
