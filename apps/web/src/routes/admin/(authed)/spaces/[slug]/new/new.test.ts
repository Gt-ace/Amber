/**
 * Route tests for /admin/spaces/[slug]/new. Single-space fixture in a throwaway
 * tmpdir, seeded auth.db with an install-admin, an editor, and a non-member.
 * Drives load + the create action directly (no HTTP).
 *
 * These tests deliberately do NOT put a `Space` on `locals.space`, and they set
 * `slug = basename(workDir)` so the registry lookup matches. That mirrors a real
 * SvelteKit form POST: the action runs *before* the `[slug]` layout `load`, so
 * `locals.space` is null and the layout's access guard hasn't run. The handler
 * must resolve the space from the registry and re-assert access itself — see the
 * regression note on the "registry / authz" cases below.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations } from '$lib/server/auth-migrations';
import type { Actions } from './$types';

// Real FS + sqlite + chokidar per case; the first Space.load on a cold WSL2 box
// can exceed vitest's 5s default. Mirror the sibling theme.test.ts headroom.
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

const FIXTURE = fileURLToPath(
	new URL('../../../../../../../fixtures/example-space/', import.meta.url)
);

let workDir: string;
let slug: string;

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-new-'));
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });
	mkdirSync(join(workDir, '.amber'), { recursive: true });

	delete process.env.AMBER_SPACES_DIR;
	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	process.env.AMBER_PUBLIC_URL = 'http://localhost:5173';

	slug = basename(workDir);

	const db = new Database(join(workDir, '.amber', 'auth.db'));
	db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
		emailVerified INTEGER NOT NULL DEFAULT 0,
		createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL);`);
	applyAmberAuthMigrations(db);
	const now = Date.now();
	db.run(
		'INSERT INTO user (id, email, isInstallAdmin, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?)',
		['admin', 'a@x.test', now, now]
	);
	db.run('INSERT INTO user (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)', [
		'editor',
		'e@x.test',
		now,
		now
	]);
	db.run('INSERT INTO user (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)', [
		'stranger',
		's@x.test',
		now,
		now
	]);
	db.run('INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)', [
		'm-editor',
		'editor',
		slug,
		'editor',
		now
	]);
	db.close();
});

afterEach(async () => {
	const { _resetAuthSingleton } = await import('$lib/server/auth-config');
	const { __resetRegistryForTests } = await import('$lib/server/space');
	await __resetRegistryForTests();
	_resetAuthSingleton();
	vi.restoreAllMocks();
	rmSync(workDir, { recursive: true, force: true });
	delete process.env.AMBER_SPACE_PATH;
});

/**
 * Build an action event the way a real form POST arrives: a `locals.user` (set
 * by the hook), but no `locals.space` (the `[slug]` layout load hasn't run).
 * Calls `getSpace()` so the registry is populated for the handler to resolve.
 */
async function actionEvent(
	user: { id: string; isInstallAdmin: boolean },
	fields: Record<string, string>
) {
	const { getSpace } = await import('$lib/server/space');
	getSpace(); // populate the registry; the handler resolves from it
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		request: { formData: async () => fd, headers: new Headers() },
		locals: {
			user: { ...user, email: 'x@x', name: null },
			access: null,
			role: null,
			space: null,
			mountPath: null
		},
		params: { slug }
	} as unknown as Parameters<NonNullable<Actions['default']>>[0];
}

/** The create action redirects on success — assert by catching the redirect. */
async function runExpectingRedirect(
	user: { id: string; isInstallAdmin: boolean },
	fields: Record<string, string>
): Promise<string> {
	try {
		const { actions } = await import('./+page.server.ts');
		await actions.default!(await actionEvent(user, fields));
		throw new Error('expected a redirect, got none');
	} catch (e) {
		const r = e as { status?: number; location?: string };
		if (r.status === undefined || r.location === undefined) throw e;
		return r.location;
	}
}

const EDITOR = { id: 'editor', isInstallAdmin: false };

describe('per-space new-page create action', () => {
	test('resolves the Space from the registry during a POST (locals.space is null)', async () => {
		// Regression: the action runs before the [slug] layout load, so locals.space
		// is null. It must resolve from the registry, not read locals.space.
		const location = await runExpectingRedirect(EDITOR, {
			directory: 'notes',
			filename: 'fresh-note',
			title: 'Fresh Note',
			draft: ''
		});
		expect(location).toBe(`/admin/spaces/${slug}/edit/notes/fresh-note`);
		expect(existsSync(join(workDir, 'notes/fresh-note.md'))).toBe(true);
	});

	test('a logged-in non-member is 404, with no file written', async () => {
		// Regression: the action also bypasses the layout's requireSpaceAccess guard,
		// so it must re-assert access itself. Asserting no-file-written locks the
		// property that the guard runs *before* the write.
		const { actions } = await import('./+page.server.ts');
		await expect(
			actions.default!(
				await actionEvent(
					{ id: 'stranger', isInstallAdmin: false },
					{
						directory: '',
						filename: 'sneaky',
						title: 'X',
						draft: ''
					}
				)
			)
		).rejects.toMatchObject({ status: 404 });
		expect(existsSync(join(workDir, 'sneaky.md'))).toBe(false);
	});

	test('install-admin (not a member) can create', async () => {
		await runExpectingRedirect(
			{ id: 'admin', isInstallAdmin: true },
			{
				directory: '',
				filename: 'admin-made',
				title: 'Admin',
				draft: ''
			}
		);
		expect(existsSync(join(workDir, 'admin-made.md'))).toBe(true);
	});

	test('appends .md when the filename omits it', async () => {
		await runExpectingRedirect(EDITOR, {
			directory: '',
			filename: 'top-level',
			title: 'Top',
			draft: ''
		});
		expect(existsSync(join(workDir, 'top-level.md'))).toBe(true);
	});

	test('rejects a reserved-prefix filename', async () => {
		const { actions } = await import('./+page.server.ts');
		const result = await actions.default!(
			await actionEvent(EDITOR, { directory: '', filename: '_secret', title: 'X', draft: '' })
		);
		expect((result as { status: number }).status).toBe(400);
		expect(existsSync(join(workDir, '_secret.md'))).toBe(false);
	});

	test('rejects an already-existing file', async () => {
		const { actions } = await import('./+page.server.ts');
		const result = await actions.default!(
			await actionEvent(EDITOR, { directory: '', filename: 'about', title: 'X', draft: '' })
		);
		expect((result as { status: number }).status).toBe(400);
	});

	test('rejects a directory not in the content tree', async () => {
		const { actions } = await import('./+page.server.ts');
		const result = await actions.default!(
			await actionEvent(EDITOR, { directory: 'made-up-dir', filename: 'x', title: 'X', draft: '' })
		);
		expect((result as { status: number }).status).toBe(400);
	});

	test('rejects a duplicate URL (index.md whose folder URL already exists)', async () => {
		// `projects/index.md` already serves `/projects`; a new `projects.md`
		// would resolve to `/projects` too.
		const { actions } = await import('./+page.server.ts');
		const result = await actions.default!(
			await actionEvent(EDITOR, { directory: '', filename: 'projects', title: 'X', draft: '' })
		);
		expect((result as { status: number }).status).toBe(400);
	});

	test('draft checkbox seeds draft: true in the new file', async () => {
		await runExpectingRedirect(EDITOR, {
			directory: '',
			filename: 'a-draft',
			title: 'Draft',
			draft: 'on'
		});
		expect(readFileSync(join(workDir, 'a-draft.md'), 'utf8')).toContain('draft: true');
	});
});
