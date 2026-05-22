/**
 * Resolves the [slug] route parameter to a `Space` via the registry. Acts as
 * the per-space scope guard for every admin page underneath: the page list,
 * the editor, the new-page form, and the JSON save endpoint all read
 * `locals.space` set here, not `getSpace()`.
 *
 * Spec §2 — single-admin: every signed-in admin can edit every loaded
 * space. The (authed) layout above us has already verified the session;
 * this layer only checks that the slug resolves to a known space.
 */

import { error } from '@sveltejs/kit';
import path from 'node:path';
import type { LayoutServerLoad } from './$types';
import { getRegistryEntries } from '$lib/server/space';

export const load: LayoutServerLoad = ({ params, locals }) => {
	const entries = getRegistryEntries();
	const match = entries.find((e) => path.basename(e.path) === params.slug);
	if (!match) error(404, `no space with slug "${params.slug}"`);

	locals.space = match.space;
	locals.mountPath = null;

	return { slug: params.slug, spaceTitle: match.space.manifest.site?.title ?? params.slug };
};
