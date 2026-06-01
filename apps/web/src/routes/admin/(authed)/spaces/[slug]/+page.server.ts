/**
 * Per-space admin index (spec §2). Enumerates Space.pages — drafts included
 * and marked. Unlike the public nav (which hides drafts), the admin index
 * is a consumer that *shows* them: "loader produces; consumers decide".
 *
 * Reads `locals.space` and `locals.role` set by the per-space [slug] layout
 * above; auth is enforced by the (authed) +layout.server.ts guard. Also
 * surfaces the active theme + public URL for the owner/install-admin "Theme:"
 * affordance (subsystem 6).
 */

import type { PageServerLoad } from './$types';
import { readSpaceConfig } from '$lib/space/config';
import { publicUrlForSpace } from '$lib/server/space-routing';
import { getDiscoveryMode } from '$lib/server/space';

export const load = (({ locals, params }) => {
	const space = locals.space;
	if (!space) throw new Error('locals.space not set by [slug]/+layout.server.ts');
	const pages = [...space.pages.values()]
		.map((p) => ({
			url: p.url,
			title: p.frontmatter.title ?? p.url,
			draft: p.frontmatter.draft === true,
			apiPath: p.url === '/' ? '' : p.url.slice(1)
		}))
		.sort((a, b) => a.url.localeCompare(b.url));

	const canPickTheme = locals.role === 'owner' || locals.role === 'install-admin';
	const { config } = readSpaceConfig(space.root);
	const publicUrl = publicUrlForSpace(config, process.env.AMBER_PUBLIC_URL!, getDiscoveryMode());

	return {
		pages,
		slug: params.slug,
		activeThemeName: space.theme.name,
		publicUrl,
		canPickTheme
	};
}) satisfies PageServerLoad;
