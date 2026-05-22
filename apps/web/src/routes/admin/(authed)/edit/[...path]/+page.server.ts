/**
 * v0.5 subsystem 3 backward-compat shim. Redirects /admin/edit/[...path]
 * (the subsystem-2 URL) to /admin/spaces/[default]/edit/[...path] where
 * [default] is the slug of the first registered space — i.e. the lone
 * space in single-space mode. May be removed in v0.6.
 */

import { redirect } from '@sveltejs/kit';
import path from 'node:path';
import { getRegistryEntries } from '$lib/server/space';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = ({ params, url }) => {
	const entries = getRegistryEntries();
	if (entries.length === 0) redirect(302, '/admin');
	const defaultSlug = path.basename(entries[0].path);
	const target = `/admin/spaces/${defaultSlug}/edit/${params.path}${url.search}`;
	redirect(302, target);
};
