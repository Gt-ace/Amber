/**
 * v0.5 subsystem 3 backward-compat shim. Redirects /admin/new (the
 * subsystem-2 URL) to /admin/spaces/[default]/new where [default] is the
 * slug of the first registered space — i.e. the lone space in single-space
 * mode. May be removed in v0.6.
 */

import { redirect } from '@sveltejs/kit';
import path from 'node:path';
import { getRegistryEntries } from '$lib/server/space';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ url }) => {
	const entries = getRegistryEntries();
	if (entries.length === 0) redirect(302, '/admin');
	const defaultSlug = path.basename(entries[0].path);
	redirect(302, `/admin/spaces/${defaultSlug}/new${url.search}`);
};
