/**
 * Space picker (spec §2). Lists every loaded space and links to
 * `/admin/spaces/[slug]`. Single-space mode: 302 directly to
 * `/admin/spaces/[lone-slug]` so subsystem-2 bookmarks land where users expect.
 */

import { redirect } from '@sveltejs/kit';
import path from 'node:path';
import type { PageServerLoad } from './$types';
import { getRegistryEntries } from '$lib/server/space';

export const load = (({ locals }) => {
	const entries = getRegistryEntries();
	if (entries.length === 1) {
		const slug = path.basename(entries[0].path);
		redirect(302, `/admin/spaces/${slug}`);
	}
	const list = entries
		.map((e) => ({
			slug: path.basename(e.path),
			title: e.space.manifest.site?.title ?? path.basename(e.path)
		}))
		.sort((a, b) => a.slug.localeCompare(b.slug));
	return { spaces: list, user: locals.user };
}) satisfies PageServerLoad;
