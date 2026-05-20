/**
 * New-page form (spec §6). Lists existing content directories for a picker;
 * the create action validates entirely on the server before any write, writes
 * a minimal-frontmatter file to disk (filesystem is truth — the file exists
 * before the editor opens it), and redirects to the editor.
 *
 * v1 does not create directories. Auth is enforced by the admin
 * +layout.server.ts guard.
 */

import { fail, redirect } from '@sveltejs/kit';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Actions, PageServerLoad } from './$types';
import { getSpace } from '$lib/server/space';
import { recombine, reserializeFrontmatter } from '$lib/server/editor';

/** Reserved-prefix test applied to every path segment (root CLAUDE.md). */
function hasReservedSegment(relPath: string): boolean {
	return relPath.split('/').some((seg) => seg.startsWith('_') || seg.startsWith('.'));
}

/** Directories that already hold pages, derived from the Space index. */
function contentDirectories(): string[] {
	const dirs = new Set<string>(['']);
	for (const page of getSpace().pages.values()) {
		const parts = page.relativePath.split('/');
		parts.pop(); // drop the filename
		let acc = '';
		for (const seg of parts) {
			acc = acc ? `${acc}/${seg}` : seg;
			dirs.add(acc);
		}
	}
	return [...dirs].sort();
}

/** Derive the public URL the loader would assign to `<dir>/<filename>`. */
function deriveUrl(dir: string, filename: string): string {
	const base = filename.replace(/\.md$/, '');
	if (base === 'index') return dir === '' ? '/' : `/${dir}`;
	const rel = dir === '' ? base : `${dir}/${base}`;
	return `/${rel}`;
}

export const load: PageServerLoad = () => {
	return { directories: contentDirectories() };
};

export const actions: Actions = {
	default: async ({ request }) => {
		const form = await request.formData();
		const directory = String(form.get('directory') ?? '');
		const title = String(form.get('title') ?? '').trim();
		const draft = form.get('draft') != null && form.get('draft') !== '';
		let filename = String(form.get('filename') ?? '').trim();

		// Filename: basename only, `.md` appended if omitted.
		if (filename === '') return fail(400, { error: 'A filename is required.' });
		if (filename.includes('/') || filename.includes('\\')) {
			return fail(400, { error: 'The filename must be a basename, not a path.' });
		}
		if (!filename.endsWith('.md')) filename = `${filename}.md`;

		// Directory must be an existing content directory — no free-text paths.
		if (!contentDirectories().includes(directory)) {
			return fail(400, { error: `Unknown directory: ${directory}` });
		}

		const relPath = directory === '' ? filename : `${directory}/${filename}`;

		// Reserved prefixes / names are rejected anywhere in the path.
		if (hasReservedSegment(relPath) || filename === 'amber.toml') {
			return fail(400, { error: 'That name uses a reserved prefix (`_`, `.`) or name.' });
		}

		const space = getSpace();
		const absPath = join(space.root, relPath);
		if (existsSync(absPath)) {
			return fail(400, { error: `A file already exists at ${relPath}.` });
		}

		const url = deriveUrl(directory, filename);
		if (space.pages.has(url)) {
			return fail(400, { error: `A page already serves ${url}.` });
		}

		// Minimal frontmatter: title, today's date, draft only when checked.
		const fmBlock = reserializeFrontmatter(
			{},
			{ title: title || undefined, date: new Date().toISOString().slice(0, 10), draft }
		);
		writeFileSync(absPath, recombine(fmBlock, ''), 'utf8');

		// Redirect to the editor; the watcher indexes the new file via Space.apply().
		redirect(303, `/admin/edit${url === '/' ? '' : url}`);
	}
};
