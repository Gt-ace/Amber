/**
 * PUT /admin/spaces/[slug]/api/page/[...path] — the editor's save endpoint
 * (spec §5, §7).
 *
 * Raw JSON, never multipart (multipart normalizes newlines to CRLF). The
 * request carries the body always and `frontmatter` only when the panel was
 * edited. `If-Match` carries the SHA-256 the editor captured at load time;
 * `If-Match: *` is an unconditional overwrite.
 *
 * The write lands on disk and the existing watcher → Space.apply() → render
 * pipeline picks it up. This handler never touches the cache or the index.
 *
 * `+server.ts` modules are not covered by layout loads, so this calls
 * `requireAuthor()` itself in addition to the (authed) layout above. The
 * per-space [slug] layout sets `locals.space`, but +server.ts also bypasses
 * layout loads — so we resolve the space from the registry here using the
 * `[slug]` route param.
 */

import path from 'node:path';
import { error, json } from '@sveltejs/kit';
import { readFileSync, writeFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import type { RequestHandler } from './$types';
import { requireAuthor } from '$lib/server/auth';
import { getRegistryEntries } from '$lib/server/space';
import {
	hashContent,
	splitRaw,
	recombine,
	reserializeFrontmatter,
	type EditableFrontmatter
} from '$lib/server/editor';

/** `[...path]` → canonical URL key (leading slash, no trailing, `/` for root). */
function resolveUrl(raw: string | undefined): string {
	const p = raw ?? '';
	return p === '' ? '/' : '/' + p.replace(/\/+$/, '');
}

interface SavePayload {
	body?: unknown;
	frontmatter?: EditableFrontmatter;
}

export const PUT: RequestHandler = async (event) => {
	requireAuthor(event);

	const slug = event.params.slug;
	const match = getRegistryEntries().find((e) => path.basename(e.path) === slug);
	if (!match) error(404, `no space with slug "${slug}"`);
	const space = match.space;

	const url = resolveUrl(event.params.path);
	const page = space.pages.get(url);
	if (!page) error(404, `No page at ${url}`);

	let payload: SavePayload;
	try {
		payload = (await event.request.json()) as SavePayload;
	} catch {
		error(400, 'The request body must be valid JSON.');
	}
	if (typeof payload.body !== 'string') {
		error(400, 'The save request must include a string `body`.');
	}

	const current = readFileSync(page.filePath, 'utf8');
	const currentHash = hashContent(current);

	// `If-Match` is required: an absent header (null) matches neither '*' nor
	// the current hash, so it fails closed with a 409. The editor always sends it.
	const ifMatch = event.request.headers.get('If-Match');
	if (ifMatch !== '*' && ifMatch !== currentHash) {
		error(409, 'The file changed on disk since the editor opened it.');
	}

	const { fmBlock, fmInner } = splitRaw(current);

	let newContent: string;
	if (payload.frontmatter === undefined) {
		// Body-only save — re-prepend the verbatim frontmatter block (spec §3).
		newContent = recombine(fmBlock, payload.body);
	} else if (fmBlock === '') {
		// The page has no frontmatter on disk but the panel sent some — serialize fresh.
		newContent = recombine(reserializeFrontmatter({}, payload.frontmatter), payload.body);
	} else {
		// Frontmatter edited — parse the COMPLETE on-disk mapping so every
		// non-editable key (description, updated, auto_index, …) survives.
		let parsed: unknown;
		try {
			parsed = parseYaml(fmInner);
		} catch {
			error(422, 'The frontmatter YAML cannot be parsed; fix it in the file first.');
		}
		if (parsed != null && (typeof parsed !== 'object' || Array.isArray(parsed))) {
			error(422, 'The frontmatter is not a YAML mapping; fix it in the file first.');
		}
		newContent = recombine(
			reserializeFrontmatter((parsed as Record<string, unknown>) ?? {}, payload.frontmatter),
			payload.body
		);
	}

	writeFileSync(page.filePath, newContent, 'utf8');
	return json({ hash: hashContent(newContent) });
};
