import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Actions } from './$types';

const FIXTURE = fileURLToPath(new URL('../../../../../fixtures/example-space/', import.meta.url));

let workDir: string;
let actions: Actions;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-new-'));
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });
	process.env.AMBER_SPACE_PATH = workDir;
	actions = (await import('./+page.server.ts')).actions;
});

afterEach(async () => {
	(await import('$lib/server/space')).getSpace().close();
	rmSync(workDir, { recursive: true, force: true });
});

function formEvent(fields: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		request: { formData: async () => fd }
	} as unknown as Parameters<NonNullable<Actions['default']>>[0];
}

/** The create action redirects on success — assert by catching the redirect. */
async function runExpectingRedirect(fields: Record<string, string>): Promise<string> {
	try {
		await actions.default!(formEvent(fields));
		throw new Error('expected a redirect, got none');
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (r.status === undefined || r.location === undefined) throw e;
		return r.location;
	}
}

describe('new-page create action', () => {
	test('creates a file and redirects to its editor', async () => {
		const location = await runExpectingRedirect({
			directory: 'notes',
			filename: 'fresh-note',
			title: 'Fresh Note',
			draft: ''
		});
		expect(location).toBe('/admin/edit/notes/fresh-note');
		expect(existsSync(join(workDir, 'notes/fresh-note.md'))).toBe(true);
	});

	test('appends .md when the filename omits it', async () => {
		await runExpectingRedirect({ directory: '', filename: 'top-level', title: 'Top', draft: '' });
		expect(existsSync(join(workDir, 'top-level.md'))).toBe(true);
	});

	test('rejects a reserved-prefix filename', async () => {
		const result = await actions.default!(
			formEvent({ directory: '', filename: '_secret', title: 'X', draft: '' })
		);
		expect((result as { status: number }).status).toBe(400);
		expect(existsSync(join(workDir, '_secret.md'))).toBe(false);
	});

	test('rejects an already-existing file', async () => {
		const result = await actions.default!(
			formEvent({ directory: '', filename: 'about', title: 'X', draft: '' })
		);
		expect((result as { status: number }).status).toBe(400);
	});

	test('rejects a directory not in the content tree', async () => {
		const result = await actions.default!(
			formEvent({ directory: 'made-up-dir', filename: 'x', title: 'X', draft: '' })
		);
		expect((result as { status: number }).status).toBe(400);
	});

	test('rejects a duplicate URL (index.md whose folder URL already exists)', async () => {
		// `projects/index.md` already serves `/projects`; a new `projects.md`
		// would resolve to `/projects` too.
		const result = await actions.default!(
			formEvent({ directory: '', filename: 'projects', title: 'X', draft: '' })
		);
		expect((result as { status: number }).status).toBe(400);
	});

	test('draft checkbox seeds draft: true in the new file', async () => {
		await runExpectingRedirect({ directory: '', filename: 'a-draft', title: 'Draft', draft: 'on' });
		const { readFileSync } = await import('node:fs');
		expect(readFileSync(join(workDir, 'a-draft.md'), 'utf8')).toContain('draft: true');
	});
});
