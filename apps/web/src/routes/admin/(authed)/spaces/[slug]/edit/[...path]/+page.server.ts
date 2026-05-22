/**
 * Editor page load (spec §2, §3, §10). Resolves `[...path]` (the page's public
 * URL) to a source file through the per-space Space index, reads it, and
 * returns the body for Crepe plus the three editable frontmatter fields for
 * the side panel.
 *
 * Reads `locals.space` set by the per-space [slug] layout above; auth is
 * enforced by the (authed) +layout.server.ts guard. `fmEditable` is false
 * when the on-disk YAML does not parse — the client disables the
 * frontmatter panel in that case (spec §3).
 */

import { error } from '@sveltejs/kit';
import { readFileSync } from 'node:fs';
import type { PageServerLoad } from './$types';
import { splitFrontmatter } from '$lib/space/load';
import { hashContent } from '$lib/server/editor';

export const load: PageServerLoad = ({ params, locals }) => {
	const space = locals.space;
	if (!space) throw new Error('locals.space not set by [slug]/+layout.server.ts');

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
