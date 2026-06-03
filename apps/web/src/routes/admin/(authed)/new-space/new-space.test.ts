/**
 * Route tests for /admin/new-space. Boots a multi-space fixture in a
 * throwaway tmpdir, primes the registry, and exercises load + action
 * directly (no HTTP).
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, cpSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations } from '$lib/server/auth-migrations';

const FIXTURE = fileURLToPath(
	new URL('../../../../../fixtures/multi-space-fixture/', import.meta.url)
);

let workDir: string;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-newspace-'));
	cpSync(FIXTURE, workDir, { recursive: true });
	mkdirSync(join(workDir, '.amber'), { recursive: true });

	delete process.env.AMBER_SPACE_PATH;
	process.env.AMBER_SPACES_DIR = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	process.env.AMBER_PUBLIC_URL = 'http://admin.test';

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
	db.close();

	// Prime the registry + resolver index.
	const { setResolverIndex } = await import('$lib/server/resolver-index-holder');
	const { buildResolverIndex } = await import('$lib/server/resolver-index');
	const { setReroutePrefixes } = await import('$lib/reroute-prefixes');
	const { setDefaultSlug } = await import('$lib/server/default-space');
	const { discoverSpaces } = await import('$lib/server/spaces-dir');
	const { getSpace } = await import('$lib/server/space');
	const { readSpaceConfig } = await import('$lib/space/config');
	const { parseSpaceRouting } = await import('$lib/server/space-routing');

	const { entries } = discoverSpaces(workDir);
	const loaded = entries.map((e) => {
		const space = getSpace(e.absPath);
		const { config } = readSpaceConfig(space.root);
		const { routing } = parseSpaceRouting(config ?? {}, e.slug, 'admin.test');
		return { slug: e.slug, space, routing };
	});
	const { index } = buildResolverIndex(loaded, 'admin.test', 'http:');
	setResolverIndex(index);
	setReroutePrefixes(index.prefixes.map((p) => p.prefix));
	setDefaultSlug(loaded.find((l) => l.space === index.default)?.slug ?? null);
});

afterEach(async () => {
	const { _resetAuthSingleton } = await import('$lib/server/auth-config');
	const { __resetRegistryForTests } = await import('$lib/server/space');
	const { __resetResolverIndexForTests } = await import('$lib/server/resolver-index-holder');
	await __resetRegistryForTests();
	__resetResolverIndexForTests();
	_resetAuthSingleton();
	rmSync(workDir, { recursive: true, force: true });
	delete process.env.AMBER_SPACES_DIR;
});

function loadEvent(user: { id: string; isInstallAdmin: boolean } | null) {
	return {
		locals: { user, access: null, role: null, space: null, mountPath: null }
	} as unknown as Parameters<typeof import('./+page.server.ts').load>[0];
}

function actionEvent(
	user: { id: string; isInstallAdmin: boolean } | null,
	fields: Record<string, string>
) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		locals: { user, access: null, role: null, space: null, mountPath: null },
		request: { formData: async () => fd, headers: new Headers() }
	} as unknown as Parameters<
		NonNullable<(typeof import('./+page.server.ts').actions)['default']>
	>[0];
}

// svelte-check widens PageServerLoad's return to include `void`; strip it so
// reads off the resolved data type-check. Runtime is unchanged.
type LoadData = Exclude<Awaited<ReturnType<typeof import('./+page.server.ts').load>>, void>;

describe('/admin/new-space load', () => {
	test('install-admin: returns the empty form data shape', async () => {
		const { load } = await import('./+page.server.ts');
		const data = (await load(loadEvent({ id: 'admin', isInstallAdmin: true }))) as LoadData;
		expect(data.discoveryMode).toBe('multi-space');
		// multi-space-fixture/site-default declares `default = true`, so the
		// form should see it and disable the "make this the default" option.
		expect(data.defaultOwner).toBe('site-default');
	});

	test('non-admin editor: 403', async () => {
		const { load } = await import('./+page.server.ts');
		await expect(load(loadEvent({ id: 'editor', isInstallAdmin: false }))).rejects.toMatchObject({
			status: 403
		});
	});

	test('single-space mode: 404', async () => {
		delete process.env.AMBER_SPACES_DIR;
		process.env.AMBER_SPACE_PATH = workDir;
		const { load } = await import('./+page.server.ts');
		await expect(load(loadEvent({ id: 'admin', isInstallAdmin: true }))).rejects.toMatchObject({
			status: 404
		});
	});
});

describe('/admin/new-space action', () => {
	test('happy path: creates the space, hot-adds, redirects to /admin/spaces/<slug>', async () => {
		const { actions } = await import('./+page.server.ts');
		try {
			await actions.default!(
				actionEvent(
					{ id: 'admin', isInstallAdmin: true },
					{
						title: 'New Site',
						slug: 'newsite',
						routingKind: 'prefix',
						prefix: '/newsite',
						host: ''
					}
				)
			);
			expect.unreachable('action should have redirected');
		} catch (r) {
			const re = r as { status: number; location: string };
			expect(re.status).toBe(302);
			expect(re.location).toBe('/admin/spaces/newsite');
		}
		expect(existsSync(join(workDir, 'newsite', 'amber.toml'))).toBe(true);
		const { getRegistryEntries } = await import('$lib/server/space');
		expect(getRegistryEntries().some((e) => e.path.endsWith('/newsite'))).toBe(true);
	});

	test('form-rejection: slug taken (collides with existing fixture space)', async () => {
		const { actions } = await import('./+page.server.ts');
		const r = await actions.default!(
			actionEvent(
				{ id: 'admin', isInstallAdmin: true },
				{
					title: 'Dupe',
					slug: 'site-a', // already present in multi-space-fixture
					routingKind: 'admin-only',
					host: '',
					prefix: ''
				}
			)
		);
		const res = r as { status: number; data: { errors: Array<{ code: string }> } };
		expect(res.status).toBe(400);
		expect(res.data.errors.some((e) => e.code === 'slug_taken')).toBe(true);
		expect(existsSync(join(workDir, 'site-a', 'space.toml'))).toBe(true); // untouched
	});

	test('addSpace fails after write: route rmSyncs partial dir, returns write_failed', async () => {
		// Spec §8 / followups: the writer's failure modes are unit-tested in
		// space-create.test.ts. The route-side path where the writer succeeded
		// but addSpace threw — and the route does its own rmSync cleanup — is
		// exercised here. Spy mid-call so we can confirm the directory existed
		// on disk *before* throwing, then assert the route's rollback ran.
		const spaceMod = await import('$lib/server/space');
		const spy = vi.spyOn(spaceMod, 'addSpace').mockImplementationOnce(async (absPath: string) => {
			// Writer just finished; the partial directory should exist.
			expect(existsSync(absPath)).toBe(true);
			throw new Error('injected addSpace failure');
		});

		const { actions } = await import('./+page.server.ts');
		const r = await actions.default!(
			actionEvent(
				{ id: 'admin', isInstallAdmin: true },
				{
					title: 'Doomed',
					slug: 'doomed',
					routingKind: 'admin-only',
					host: '',
					prefix: ''
				}
			)
		);
		const res = r as { status: number; data: { writeError: string } };

		expect(res.status).toBe(500);
		expect(res.data.writeError).toBe('write_failed');
		// Route's rmSync cleanup wiped the partial dir.
		expect(existsSync(join(workDir, 'doomed'))).toBe(false);
		expect(spy).toHaveBeenCalledTimes(1);

		spy.mockRestore();
	});

	test('non-admin action: 403', async () => {
		const { actions } = await import('./+page.server.ts');
		await expect(
			actions.default!(
				actionEvent(
					{ id: 'editor', isInstallAdmin: false },
					{
						title: 'Sneaky',
						slug: 'sneaky',
						routingKind: 'admin-only',
						host: '',
						prefix: ''
					}
				)
			)
		).rejects.toMatchObject({ status: 403 });
		expect(existsSync(join(workDir, 'sneaky'))).toBe(false);
	});
});
