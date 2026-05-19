/**
 * Admin index (spec §2). Enumerates Space.pages — drafts included and marked.
 * Unlike the public nav (which hides drafts), the admin index is a consumer
 * that *shows* them: "loader produces; consumers decide". Auth is enforced by
 * the admin +layout.server.ts guard.
 */

import type { PageServerLoad } from './$types';
import { getSpace } from '$lib/server/space';

export const load = ((_event) => {
	const pages = [...getSpace().pages.values()]
		.map((p) => ({
			url: p.url,
			title: p.frontmatter.title ?? p.url,
			draft: p.frontmatter.draft === true,
			apiPath: p.url === '/' ? '' : p.url.slice(1)
		}))
		.sort((a, b) => a.url.localeCompare(b.url));

	return { pages };
}) satisfies PageServerLoad;
