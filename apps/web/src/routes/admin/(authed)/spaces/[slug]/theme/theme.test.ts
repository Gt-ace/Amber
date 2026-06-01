/**
 * Route tests for /admin/spaces/[slug]/theme. Single-space fixture in a
 * throwaway tmpdir (example-space + two minimal discovered themes), seeded
 * auth.db with an install-admin, an owner, and an editor. Drives load + action
 * directly (no HTTP).
 *
 * The non-member → 404 case is the [slug] layout's responsibility and is
 * already covered by layout-access.test.ts; it is not re-tested here.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, cpSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations } from '$lib/server/auth-migrations';

const FIXTURE = fileURLToPath(new URL('../../../../../../../fixtures/example-space/', import.meta.url));

let workDir: string;
let slug: string;

function writeTheme(spaceRoot: string, name: string): void {
	const d = join(spaceRoot, 'themes', name);
	mkdirSync(d, { recursive: true });
	writeFileSync(join(d, 'theme.toml'), `name = "${name}"\nversion = "0.1.0"\nauthor = "test"\n`);
	writeFileSync(join(d, 'chrome.html'), '<header></header>\n<!--amber:content-->\n<footer></footer>');
	writeFileSync(join(d, 'page.html'), '<article>{{{html}}}</article>');
	writeFileSync(join(d, 'error.html'), '<h1>{{status}}</h1>');
}

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-theme-'));
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });
	mkdirSync(join(workDir, '.amber'), { recursive: true });
	writeTheme(workDir, 'amber-default');
	writeTheme(workDir, 'amber-editorial');

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
	db.run('INSERT INTO user (id, email, isInstallAdmin, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?)', [
		'admin', 'a@x.test', now, now
	]);
	db.run('INSERT INTO user (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)', ['owner', 'o@x.test', now, now]);
	db.run('INSERT INTO user (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)', ['editor', 'e@x.test', now, now]);
	db.run('INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)', [
		'm-owner', 'owner', slug, 'owner', now
	]);
	db.run('INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)', [
		'm-editor', 'editor', slug, 'editor', now
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

async function actionEvent(user: { id: string; isInstallAdmin: boolean }, fields: Record<string, string>) {
	const { getSpace } = await import('$lib/server/space');
	const space = getSpace();
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		params: { slug },
		locals: {
			user: { ...user, email: 'x@x', name: null },
			access: null,
			role: null,
			space,
			mountPath: null
		},
		request: { formData: async () => fd, headers: new Headers() }
	} as unknown as Parameters<NonNullable<typeof import('./+page.server.ts').actions.default>>[0];
}

describe('/admin/spaces/[slug]/theme load', () => {
	test('editor of this space → 403', async () => {
		const { load } = await import('./+page.server.ts');
		await expect(load(await loadEvent({ id: 'editor', isInstallAdmin: false }))).rejects.toMatchObject({
			status: 403
		});
	});

	test('owner → picker shape with discovered themes', async () => {
		const { load } = await import('./+page.server.ts');
		const data = await load(await loadEvent({ id: 'owner', isInstallAdmin: false }));
		expect(data.themes.map((t) => t.name)).toEqual(['amber-default', 'amber-editorial']);
		expect(data.declaredTheme).toBeNull(); // no space.toml theme yet
		expect(data.themeSource).toBe('inherited');
		expect(data.staleThemeName).toBeNull();
		expect(data.publicUrl).toBe('http://localhost:5173/'); // single-space
	});

	test('install-admin (not a member) → same shape', async () => {
		const { load } = await import('./+page.server.ts');
		const data = await load(await loadEvent({ id: 'admin', isInstallAdmin: true }));
		expect(data.themes.length).toBe(2);
	});

	test('stale declared theme → staleThemeName populated, source inherited', async () => {
		writeFileSync(join(workDir, 'space.toml'), 'theme = "ghost"\n');
		const { load } = await import('./+page.server.ts');
		const data = await load(await loadEvent({ id: 'owner', isInstallAdmin: false }));
		expect(data.declaredTheme).toBe('ghost');
		expect(data.staleThemeName).toBe('ghost');
		expect(data.themeSource).toBe('inherited');
	});
});

describe('/admin/spaces/[slug]/theme action', () => {
	test('owner picks a theme → 303 + space.toml carries the theme line', async () => {
		const { actions } = await import('./+page.server.ts');
		try {
			await actions.default!(await actionEvent({ id: 'owner', isInstallAdmin: false }, { theme: 'amber-editorial' }));
			expect.unreachable('action should have redirected');
		} catch (r) {
			const re = r as { status: number; location: string };
			expect(re.status).toBe(303);
			expect(re.location).toBe(`/admin/spaces/${slug}/theme`);
		}
		expect(readFileSync(join(workDir, 'space.toml'), 'utf8')).toContain('theme = "amber-editorial"');
	});

	test('owner picks "use install default" → 303 + space.toml deleted (no routing fields)', async () => {
		writeFileSync(join(workDir, 'space.toml'), 'theme = "amber-editorial"\n');
		const { actions } = await import('./+page.server.ts');
		try {
			await actions.default!(await actionEvent({ id: 'owner', isInstallAdmin: false }, { theme: '' }));
			expect.unreachable('action should have redirected');
		} catch (r) {
			expect((r as { status: number }).status).toBe(303);
		}
		expect(existsSync(join(workDir, 'space.toml'))).toBe(false);
	});

	test('undiscovered theme → 400 theme_not_discovered, no disk change', async () => {
		const { actions } = await import('./+page.server.ts');
		const r = await actions.default!(await actionEvent({ id: 'owner', isInstallAdmin: false }, { theme: 'ghost' }));
		const res = r as { status: number; data: { themeError: string } };
		expect(res.status).toBe(400);
		expect(res.data.themeError).toBe('theme_not_discovered');
		expect(existsSync(join(workDir, 'space.toml'))).toBe(false);
	});

	test('writer failure → 500 with writeError, no redirect', async () => {
		const writerMod = await import('$lib/server/space-config-write');
		vi.spyOn(writerMod, 'writeSpaceConfig').mockResolvedValueOnce({
			kind: 'error',
			code: 'write_failed',
			detail: 'injected'
		});
		const { actions } = await import('./+page.server.ts');
		const r = await actions.default!(
			await actionEvent({ id: 'owner', isInstallAdmin: false }, { theme: 'amber-default' })
		);
		const res = r as { status: number; data: { writeError: string } };
		expect(res.status).toBe(500);
		expect(res.data.writeError).toBe('write_failed');
	});

	test('editor action → 403, no disk change', async () => {
		const { actions } = await import('./+page.server.ts');
		await expect(
			actions.default!(await actionEvent({ id: 'editor', isInstallAdmin: false }, { theme: 'amber-default' }))
		).rejects.toMatchObject({ status: 403 });
		expect(existsSync(join(workDir, 'space.toml'))).toBe(false);
	});
});
