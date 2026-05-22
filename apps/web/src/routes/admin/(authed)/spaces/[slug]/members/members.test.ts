import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// members/ is one level deeper than [slug]/, so we need 7 ../s to reach apps/web/
const FIXTURE = fileURLToPath(new URL('../../../../../../../fixtures/example-space/', import.meta.url));

let workDir: string;
let load: typeof import('./+page.server.ts').load;
let actions: typeof import('./+page.server.ts').actions;
let resetSingleton: () => void;
let getAuth: typeof import('$lib/server/auth-config').getAuth;
let getAuthDb: typeof import('$lib/server/auth-config').getAuthDb;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-members-'));
	mkdirSync(join(workDir, '.amber'), { recursive: true });
	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	process.env.AMBER_PUBLIC_URL = 'https://amber.test';
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });

	const mod = await import('./+page.server.ts');
	load = mod.load;
	actions = mod.actions;
	const cfg = await import('$lib/server/auth-config');
	resetSingleton = cfg._resetAuthSingleton;
	getAuth = cfg.getAuth;
	getAuthDb = cfg.getAuthDb;
});

afterEach(async () => {
	const { getSpace } = await import('$lib/server/space');
	try {
		getSpace().close();
	} catch {}
	resetSingleton();
	rmSync(workDir, { recursive: true, force: true });
});

async function seedAdmin(): Promise<string> {
	await getAuth();
	const db = getAuthDb();
	db.run(
		"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('admin-1', 'a@x.test', 'A', 1, ?1, ?1, 1)",
		[Date.now()]
	);
	return 'admin-1';
}

async function seedUser(id: string, email: string): Promise<void> {
	await getAuth();
	const db = getAuthDb();
	db.run(
		'INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES (?1, ?2, ?2, 1, ?3, ?3, 0)',
		[id, email, Date.now()]
	);
}

function loadEvent(user: { id: string; isInstallAdmin: boolean } | null, slug: string) {
	return {
		params: { slug },
		locals: { user, access: null, role: null },
		url: new URL(`https://amber.test/admin/spaces/${slug}/members`)
	} as unknown as Parameters<typeof load>[0];
}

function actionEvent(
	user: { id: string; isInstallAdmin: boolean } | null,
	slug: string,
	fields: Record<string, string>
) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		params: { slug },
		locals: { user, access: null, role: null },
		request: { formData: async () => fd, headers: new Headers() }
	} as unknown as Parameters<NonNullable<typeof actions.generateInvite>>[0];
}

describe('members load', () => {
	test('install-admin sees the lists even without a member row', async () => {
		await seedAdmin();
		const data = await load(loadEvent({ id: 'admin-1', isInstallAdmin: true }, 'example-space'));
		expect(data.members).toEqual([]);
		expect(data.invites).toEqual([]);
	});

	test('editor 403s', async () => {
		await seedAdmin();
		await seedUser('u-1', 'e@x.test');
		getAuthDb().run(
			"INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES ('m-1', 'u-1', 'example-space', 'editor', ?1, 'admin-1')",
			[Date.now()]
		);
		await expect(
			load(loadEvent({ id: 'u-1', isInstallAdmin: false }, 'example-space'))
		).rejects.toMatchObject({ status: 403 });
	});

	test('owner sees the lists', async () => {
		await seedAdmin();
		await seedUser('u-2', 'o@x.test');
		const db = getAuthDb();
		db.run(
			"INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES ('m-2', 'u-2', 'example-space', 'owner', ?1, 'admin-1')",
			[Date.now()]
		);
		const data = await load(loadEvent({ id: 'u-2', isInstallAdmin: false }, 'example-space'));
		expect(data.members.map((m) => m.userId)).toContain('u-2');
	});
});

describe('generateInvite action', () => {
	test('returns a fresh URL each call', async () => {
		await seedAdmin();
		const r1 = await actions.generateInvite!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, 'example-space', { role: 'editor' })
		);
		const r2 = await actions.generateInvite!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, 'example-space', { role: 'editor' })
		);
		expect((r1 as { generate: { inviteUrl: string } }).generate.inviteUrl).not.toBe(
			(r2 as { generate: { inviteUrl: string } }).generate.inviteUrl
		);
	});

	test('rejects invalid role', async () => {
		await seedAdmin();
		const r = await actions.generateInvite!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, 'example-space', { role: 'goblin' })
		);
		expect((r as { status: number }).status).toBe(400);
	});
});

describe('revokeInvite action', () => {
	test('owner can revoke; revoked URL is invalid', async () => {
		await seedAdmin();
		const created = (await actions.generateInvite!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, 'example-space', { role: 'editor' })
		)) as { generate: { inviteUrl: string } };
		const inviteId = getAuthDb()
			.query('SELECT id FROM invite WHERE space_slug = ?1')
			.get('example-space') as { id: string };
		const r = await actions.revokeInvite!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, 'example-space', { inviteId: inviteId.id })
		);
		expect((r as { revoke: { ok: true } }).revoke.ok).toBe(true);
		const pending = getAuthDb().query('SELECT COUNT(*) AS n FROM invite WHERE redeemed_at IS NULL').get();
		expect((pending as { n: number }).n).toBe(0);
		expect(created.generate.inviteUrl).toBeTruthy();
	});
});

describe('changeRole action', () => {
	test('refuses to change install-admin role', async () => {
		const adminId = await seedAdmin();
		const r = await actions.changeRole!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, 'example-space', {
				userId: adminId,
				role: 'editor'
			})
		);
		expect((r as { status: number }).status).toBe(400);
	});

	test('promotes editor to owner', async () => {
		await seedAdmin();
		await seedUser('u-1', 'e@x.test');
		const db = getAuthDb();
		db.run(
			"INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES ('m-1', 'u-1', 'example-space', 'editor', ?1, 'admin-1')",
			[Date.now()]
		);
		await actions.changeRole!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, 'example-space', {
				userId: 'u-1',
				role: 'owner'
			})
		);
		const row = db.query('SELECT role FROM member WHERE user_id = ?1').get('u-1');
		expect((row as { role: string }).role).toBe('owner');
	});
});

describe('removeMember action', () => {
	test('removes the row', async () => {
		await seedAdmin();
		await seedUser('u-1', 'e@x.test');
		const db = getAuthDb();
		db.run(
			"INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES ('m-1', 'u-1', 'example-space', 'editor', ?1, 'admin-1')",
			[Date.now()]
		);
		await actions.removeMember!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, 'example-space', { userId: 'u-1' })
		);
		const n = db.query('SELECT COUNT(*) AS n FROM member WHERE user_id = ?1').get('u-1');
		expect((n as { n: number }).n).toBe(0);
	});

	test('refuses to remove install-admin (no row to remove)', async () => {
		const adminId = await seedAdmin();
		const r = await actions.removeMember!(
			actionEvent({ id: 'admin-1', isInstallAdmin: true }, 'example-space', { userId: adminId })
		);
		expect((r as { status: number }).status).toBe(400);
	});
});
