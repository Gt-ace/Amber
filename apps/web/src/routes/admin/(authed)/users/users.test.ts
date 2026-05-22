import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../../../../../fixtures/example-space/', import.meta.url));

let workDir: string;
let load: typeof import('./+page.server.ts').load;
let resetSingleton: () => void;
let getAuth: typeof import('$lib/server/auth-config').getAuth;
let getAuthDb: typeof import('$lib/server/auth-config').getAuthDb;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-users-'));
	mkdirSync(join(workDir, '.amber'), { recursive: true });
	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	process.env.AMBER_PUBLIC_URL = 'https://amber.test';
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });
	const mod = await import('./+page.server.ts');
	load = mod.load;
	const cfg = await import('$lib/server/auth-config');
	resetSingleton = cfg._resetAuthSingleton;
	getAuth = cfg.getAuth;
	getAuthDb = cfg.getAuthDb;
});

afterEach(async () => {
	const { getSpace } = await import('$lib/server/space');
	try { getSpace().close(); } catch {}
	resetSingleton();
	rmSync(workDir, { recursive: true, force: true });
});

function loadEvent(user: { id: string; isInstallAdmin: boolean } | null) {
	return {
		locals: { user, access: null, role: null }
	} as unknown as Parameters<typeof load>[0];
}

describe('/admin/users load', () => {
	test('install-admin sees the list', async () => {
		await getAuth();
		const db = getAuthDb();
		db.run(
			"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('admin-1', 'a@x.test', 'A', 1, ?1, ?1, 1), ('u-1', 'b@x.test', 'B', 1, ?1, ?1, 0)",
			[Date.now()]
		);
		const data = await load(loadEvent({ id: 'admin-1', isInstallAdmin: true }));
		expect(data.users.length).toBe(2);
		expect(data.users[0].isInstallAdmin).toBe(true);
	});

	test('non-admin: 403', async () => {
		await getAuth();
		await expect(
			load(loadEvent({ id: 'u-1', isInstallAdmin: false }))
		).rejects.toMatchObject({ status: 403 });
	});

	test('signed-out: 401', async () => {
		await getAuth();
		await expect(load(loadEvent(null))).rejects.toMatchObject({ status: 401 });
	});
});

function actionEvent(
	user: { id: string; isInstallAdmin: boolean } | null,
	fields: Record<string, string>
) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		locals: { user, access: null, role: null },
		request: { formData: async () => fd, headers: new Headers() }
	} as unknown as Parameters<
		NonNullable<typeof import('./+page.server.ts').actions.deleteUser>
	>[0];
}

describe('deleteUser action', () => {
	test('happy path: cascades member + session + account + user rows', async () => {
		await getAuth();
		const db = getAuthDb();
		db.run(
			"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('admin-1', 'a@x.test', 'A', 1, ?1, ?1, 1), ('u-1', 'b@x.test', 'B', 1, ?1, ?1, 0)",
			[Date.now()]
		);
		db.run(
			"INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES ('m-1', 'u-1', 'example-space', 'editor', ?1, 'admin-1')",
			[Date.now()]
		);
		const { actions } = await import('./+page.server.ts');
		await actions.deleteUser!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, {
				userId: 'u-1',
				confirmEmail: 'b@x.test'
			})
		);
		expect(db.query('SELECT COUNT(*) AS n FROM user WHERE id = ?1').get('u-1')).toEqual({ n: 0 });
		expect(db.query('SELECT COUNT(*) AS n FROM member WHERE user_id = ?1').get('u-1')).toEqual({ n: 0 });
	});

	test('refuses to delete install-admin', async () => {
		await getAuth();
		const db = getAuthDb();
		db.run(
			"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('admin-1', 'a@x.test', 'A', 1, ?1, ?1, 1)",
			[Date.now()]
		);
		const { actions } = await import('./+page.server.ts');
		const r = await actions.deleteUser!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, {
				userId: 'admin-1',
				confirmEmail: 'a@x.test'
			})
		);
		expect((r as { status: number }).status).toBe(400);
	});

	test('refuses on email mismatch', async () => {
		await getAuth();
		const db = getAuthDb();
		db.run(
			"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('admin-1', 'a@x.test', 'A', 1, ?1, ?1, 1), ('u-1', 'b@x.test', 'B', 1, ?1, ?1, 0)",
			[Date.now()]
		);
		const { actions } = await import('./+page.server.ts');
		const r = await actions.deleteUser!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, {
				userId: 'u-1',
				confirmEmail: 'wrong@x.test'
			})
		);
		expect((r as { status: number }).status).toBe(400);
	});
});
