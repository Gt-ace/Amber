/**
 * Per-space admin index (spec §2). Enumerates Space.pages — drafts included
 * and marked. Unlike the public nav (which hides drafts), the admin index
 * is a consumer that *shows* them: "loader produces; consumers decide".
 *
 * Reads `locals.space` set by the per-space [slug] layout above; auth is
 * enforced by the (authed) +layout.server.ts guard.
 */

import type { PageServerLoad } from './$types';

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

	return { pages, slug: params.slug };
}) satisfies PageServerLoad;
