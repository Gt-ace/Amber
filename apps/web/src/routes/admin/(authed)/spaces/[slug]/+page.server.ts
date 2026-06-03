/**
 * Per-space admin index (spec §2). Enumerates Space.pages — drafts included
 * and marked. Unlike the public nav (which hides drafts), the admin index
 * is a consumer that *shows* them: "loader produces; consumers decide".
 *
 * Resolves the `Space` from the registry and re-asserts access here rather
 * than reading `locals.space`/`locals.role` set by the per-space `[slug]`
 * layout: on a *client-side* navigation between two children of the same
 * `[slug]` (slug unchanged), SvelteKit reuses the layout's previous `load`
 * result and does **not** re-run its `load` — so neither `locals.space` nor
 * the layout's `requireSpaceAccess` fires for that request, and this load
 * would see the `null` that `hooks.server.ts` initialised. Self-resolving
 * makes the load correct whether reached by SSR or client nav. The
 * `theme`/`new` handlers and the PUT save endpoint resolve the same way.
 *
 * Also surfaces the active theme + public URL for the owner/install-admin
 * "Theme:" affordance (subsystem 6).
 */

import { error } from '@sveltejs/kit';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Space } from '$lib/space/space';
import { readSpaceConfig } from '$lib/space/config';
import { publicUrlForSpace } from '$lib/server/space-routing';
import { getDiscoveryMode, getRegistryEntries } from '$lib/server/space';
import { requireSpaceAccess } from '$lib/server/permissions';

/** Resolve the `Space` for this route from the registry by slug. */
function resolveSpace(event: RequestEvent): Space {
	const match = getRegistryEntries().find((e) => path.basename(e.path) === event.params.slug);
	if (!match) error(404, `no space with slug "${event.params.slug}"`);
	return match.space;
}

export const load = ((event) => {
	// Self-guard (sets `locals.role`) + self-resolve — see the module note.
	requireSpaceAccess(event, event.params.slug);
	const space = resolveSpace(event);
	const { locals, params } = event;
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
