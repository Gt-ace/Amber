/**
 * Editor page load (spec §2, §3, §10). Resolves `[...path]` (the page's public
 * URL) to a source file through the per-space Space index, reads it, and
 * returns the body for Crepe plus the three editable frontmatter fields for
 * the side panel.
 *
 * Resolves the `Space` from the registry and re-asserts access here rather
 * than reading `locals.space` set by the per-space `[slug]` layout: on a
 * *client-side* navigation between two `[slug]` children (slug unchanged),
 * SvelteKit reuses the layout's previous `load` and does **not** re-run it,
 * so `locals.space` is the `null` that `hooks.server.ts` initialised. The
 * `new` handler and the PUT save endpoint resolve the same way (and an
 * `action`/PUT never runs the layout `load` at all). `'editor'` is the
 * minimum role — editing a page is the same trust level as the save
 * endpoint. `fmEditable` is false when the on-disk YAML does not parse — the
 * client disables the frontmatter panel in that case (spec §3).
 */

import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import type { Space } from '$lib/space/space';
import { splitFrontmatter } from '$lib/space/load';
import { hashContent } from '$lib/server/editor';
import { getRegistryEntries } from '$lib/server/space';
import { requireSpaceAccess } from '$lib/server/permissions';

/** Resolve the `Space` for this route from the registry by slug. */
function resolveSpace(event: RequestEvent): Space {
	const match = getRegistryEntries().find((e) => path.basename(e.path) === event.params.slug);
	if (!match) error(404, `no space with slug "${event.params.slug}"`);
	return match.space;
}

export const load: PageServerLoad = (event) => {
	// Self-guard + self-resolve — see the module note.
	requireSpaceAccess(event, event.params.slug, 'editor');
	const space = resolveSpace(event);
	const { params } = event;

	const raw = (params.path ?? '').replace(/\/+$/, '');
	const url = raw === '' ? '/' : '/' + raw;

	const page = space.pages.get(url);
	if (!page) error(404, `No page at ${url}`);

	const fileRaw = readFileSync(page.filePath, 'utf8');
	const split = splitFrontmatter(fileRaw);

	return {
		url,
		slug: params.slug,
		// The `[...path]` segment to address this page on the PUT endpoint.
		apiPath: raw,
		body: split.body,
		// False when the YAML failed to parse — the panel goes read-only (spec §3).
		fmEditable: split.parseError === undefined,
		frontmatter: {
			title: split.frontmatter.title ?? '',
			draft: split.frontmatter.draft ?? false,
			date: split.frontmatter.date ?? ''
		},
		hash: hashContent(fileRaw)
	};
};
