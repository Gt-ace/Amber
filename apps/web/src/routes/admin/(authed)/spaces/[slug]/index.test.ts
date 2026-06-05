/**
 * Route tests for the per-space admin index (/admin/spaces/[slug]). Single-space
 * fixture in a throwaway tmpdir, seeded auth.db with an install-admin, an owner,
 * and an editor. Drives the load directly (no HTTP).
 *
 * The load self-resolves the Space from the registry and self-guards via
 * `requireSpaceAccess` (it no longer reads `locals.space`/`locals.role` set by
 * the `[slug]` layout, which SvelteKit skips on client-side nav) — so the role
 * the "Theme:" affordance branches on comes from real `member` rows, not an
 * injected `locals.role`. The non-member → 404 case is the layout's job and is
 * covered by layout-access.test.ts.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations } from '$lib/server/auth-migrations';

// Real filesystem work per case (cpSync the fixture, build a SQLite cache +
// auth.db, spin a chokidar watcher via getSpace()). Match the sibling
// theme/layout-access tests' headroom so a cold WSL2 box stays deterministic.
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

const FIXTURE = fileURLToPath(
	new URL('../../../../../../fixtures/example-space/', import.meta.url)
);

let workDir: string;
let slug: string;

// svelte-check widens PageServerLoad's return to include `void`; strip it so
// reads off the resolved data type-check. Runtime is unchanged.
type LoadData = Exclude<Awaited<ReturnType<typeof import('./+page.server.ts').load>>, void>;

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-idx-'));
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
		'owner',
		'o@x.test',
		now,
		now
	]);
	db.run('INSERT INTO user (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)', [
		'editor',
		'e@x.test',
		now,
		now
	]);
	db.run('INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)', [
		'm-owner',
		'owner',
		slug,
		'owner',
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

async function loadEvent(user: { id: string; isInstallAdmin: boolean }) {
	const { getSpace } = await import('$lib/server/space');
	const space = getSpace();
	return {
		params: { slug },
		locals: {
			user: { ...user, email: 'x@x', name: null },
			access: null,
			role: null,
			space,
			mountPath: null
		}
	} as unknown as Parameters<typeof import('./+page.server.ts').load>[0];
}

async function loadData(user: { id: string; isInstallAdmin: boolean }) {
	const { load } = await import('./+page.server.ts');
	const data = (await load(await loadEvent(user))) as LoadData;
	if (!data) throw new Error('load unexpectedly returned void');
	return data;
}

const ADMIN = { id: 'admin', isInstallAdmin: true };
const OWNER = { id: 'owner', isInstallAdmin: false };
const EDITOR = { id: 'editor', isInstallAdmin: false };

describe('per-space admin index +page.server load', () => {
	test('lists every page sorted by URL, drafts marked', async () => {
		const data = await loadData(ADMIN);
		const urls = data.pages.map((p) => p.url);
		expect(urls).toEqual([...urls].sort());
		expect(urls).toContain('/');
		expect(urls).toContain('/about');

		const draft = data.pages.find((p) => p.url === '/notes/unfinished-essay');
		expect(draft?.draft).toBe(true);
		const live = data.pages.find((p) => p.url === '/about');
		expect(live?.draft).toBe(false);
	});

	test('apiPath has no leading slash and is empty for the root', async () => {
		const data = await loadData(ADMIN);
		expect(data.pages.find((p) => p.url === '/')?.apiPath).toBe('');
		expect(data.pages.find((p) => p.url === '/about')?.apiPath).toBe('about');
	});

	test('passes slug through from params', async () => {
		const data = await loadData(ADMIN);
		expect(data.slug).toBe(slug);
	});

	test('a non-member is rejected (self-guard, not just the layout)', async () => {
		const { load } = await import('./+page.server.ts');
		// The load is synchronous, so the guard throws synchronously (no promise
		// to `.rejects` against) — assert via try/catch like the editor 404 test.
		try {
			load(await loadEvent({ id: 'stranger', isInstallAdmin: false }));
			expect.unreachable('should have thrown 404');
		} catch (e) {
			expect((e as { status: number }).status).toBe(404);
		}
	});
});

describe('per-space admin index — theme affordance fields', () => {
	test('install-admin: canPickTheme true, activeThemeName set, publicUrl is the single-space origin', async () => {
		const data = await loadData(ADMIN);
		expect(data.canPickTheme).toBe(true);
		expect(typeof data.activeThemeName).toBe('string');
		expect(data.activeThemeName.length).toBeGreaterThan(0);
		expect(data.publicUrl).toBe('http://localhost:5173/');
	});

	test('owner: canPickTheme true', async () => {
		expect((await loadData(OWNER)).canPickTheme).toBe(true);
	});

	test('editor: canPickTheme false', async () => {
		expect((await loadData(EDITOR)).canPickTheme).toBe(false);
	});
});

describe('per-space admin index — members affordance field', () => {
	test('install-admin: canManageMembers true', async () => {
		expect((await loadData(ADMIN)).canManageMembers).toBe(true);
	});

	test('owner: canManageMembers true', async () => {
		expect((await loadData(OWNER)).canManageMembers).toBe(true);
	});

	test('editor: canManageMembers false', async () => {
		expect((await loadData(EDITOR)).canManageMembers).toBe(false);
	});
});
