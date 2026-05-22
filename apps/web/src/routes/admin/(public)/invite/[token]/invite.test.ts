import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(
	new URL('../../../../../../fixtures/example-space/', import.meta.url)
);

let workDir: string;
let slug: string;
let load: typeof import('./+page.server.ts').load;
let resetSingleton: () => void;
let getAuth: typeof import('$lib/server/auth-config').getAuth;
let getAuthDb: typeof import('$lib/server/auth-config').getAuthDb;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-invite-'));
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });
	mkdirSync(join(workDir, '.amber'), { recursive: true });
	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	process.env.AMBER_PUBLIC_URL = 'https://amber.test';
	slug = basename(workDir);

	const mod = await import('./+page.server.ts');
	load = mod.load;
	const cfg = await import('$lib/server/auth-config');
	resetSingleton = cfg._resetAuthSingleton;
	getAuth = cfg.getAuth;
	getAuthDb = cfg.getAuthDb;

	// Initialize auth DB schema (migrations must run before any DB access).
	await getAuth();

	// Prime the registry so getRegistryEntries() works in shape().
	const { getSpace } = await import('$lib/server/space');
	getSpace();
});

afterEach(async () => {
	const { __resetRegistryForTests } = await import('$lib/server/space');
	if (typeof __resetRegistryForTests === 'function') await __resetRegistryForTests();
	resetSingleton();
	rmSync(workDir, { recursive: true, force: true });
});

function loadEvent(
	token: string,
	user: { id: string; email: string; isInstallAdmin: boolean } | null,
	searchParams: Record<string, string> = {}
) {
	const headers = new Map<string, string>();
	const urlObj = new URL(`https://amber.test/admin/invite/${token}`);
	for (const [k, v] of Object.entries(searchParams)) urlObj.searchParams.set(k, v);
	return {
		params: { token },
		locals: { user, access: null, role: null },
		setHeaders: (h: Record<string, string>) => {
			for (const [k, v] of Object.entries(h)) headers.set(k, v);
		},
		url: urlObj,
		_headers: headers
	} as unknown as Parameters<typeof load>[0];
}

async function freshInvite(role: 'owner' | 'editor' = 'editor'): Promise<string> {
	await getAuth();
	const { insertInvite } = await import('$lib/server/invites');
	const { token } = insertInvite(getAuthDb(), {
		spaceSlug: slug,
		role,
		createdBy: 'admin-1'
	});
	return token;
}

describe('invite load — validity', () => {
	test('410 for unknown token', async () => {
		await expect(load(loadEvent('nope', null))).rejects.toMatchObject({ status: 410 });
	});

	test('410 for expired invite', async () => {
		const token = await freshInvite();
		getAuthDb().run('UPDATE invite SET expires_at = 0');
		await expect(load(loadEvent(token, null))).rejects.toMatchObject({ status: 410 });
	});

	test('410 for redeemed invite', async () => {
		const token = await freshInvite();
		getAuthDb().run("UPDATE invite SET redeemed_at = ?1, redeemed_by = 'someone'", [Date.now()]);
		await expect(load(loadEvent(token, null))).rejects.toMatchObject({ status: 410 });
	});
});

describe('invite load — state matrix', () => {
	test('signed-out → kind: signed-out', async () => {
		const token = await freshInvite();
		const data = await load(loadEvent(token, null));
		expect(data.state.kind).toBe('signed-out');
	});

	test('signed-in install-admin → kind: install-admin', async () => {
		const token = await freshInvite();
		const data = await load(
			loadEvent(token, { id: 'admin-1', email: 'a@x.test', isInstallAdmin: true })
		);
		expect(data.state.kind).toBe('install-admin');
	});

	test('signed-in existing member → kind: already-member with role', async () => {
		const token = await freshInvite();
		getAuthDb().run(
			"INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES ('m-1', 'u-1', ?1, 'editor', ?2, 'admin-1')",
			[slug, Date.now()]
		);
		const data = await load(
			loadEvent(token, { id: 'u-1', email: 'e@x.test', isInstallAdmin: false })
		);
		expect(data.state.kind).toBe('already-member');
		if (data.state.kind === 'already-member') expect(data.state.currentRole).toBe('editor');
	});

	test('signed-in non-member → kind: accept-as-current', async () => {
		const token = await freshInvite();
		const data = await load(
			loadEvent(token, { id: 'u-2', email: 'f@x.test', isInstallAdmin: false })
		);
		expect(data.state.kind).toBe('accept-as-current');
	});
});

describe('invite load — headers', () => {
	test('sets Referrer-Policy: no-referrer and Cache-Control: no-store', async () => {
		const token = await freshInvite();
		const event = loadEvent(token, null);
		await load(event);
		const headers = (event as unknown as { _headers: Map<string, string> })._headers;
		expect(headers.get('Referrer-Policy')).toBe('no-referrer');
		expect(headers.get('Cache-Control')).toBe('no-store');
	});
});

function actionEvent(token: string, fields: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		params: { token },
		locals: { user: null, access: null, role: null },
		request: { formData: async () => fd, headers: new Headers() },
		setHeaders: () => {},
		url: new URL(`https://amber.test/admin/invite/${token}`)
	} as unknown as Parameters<
		NonNullable<typeof import('./+page.server.ts').actions.redeemAsNew>
	>[0];
}

describe('redeemAsNew', () => {
	test('happy path creates user + member + marks invite redeemed', async () => {
		const token = await freshInvite('editor');
		const { actions } = await import('./+page.server.ts');
		await Promise.resolve(
			actions.redeemAsNew!(
				actionEvent(token, { email: 'invitee@x.test', password: 'password123', name: 'Invitee' })
			)
		).catch((e: unknown) => {
			if ((e as { status?: number }).status !== 302) throw e;
		});
		const db = getAuthDb();
		const user = db.query("SELECT id FROM user WHERE email = ?1").get('invitee@x.test');
		expect(user).toBeTruthy();
		const member = db.query('SELECT role FROM member WHERE space_slug = ?1').get(slug);
		expect((member as { role: string }).role).toBe('editor');
		const inv = db.query('SELECT redeemed_at FROM invite').get() as { redeemed_at: number };
		expect(inv.redeemed_at).toBeGreaterThan(0);
	});

	test('race: invite redeemed between load and action → 410', async () => {
		const token = await freshInvite('editor');
		const { actions } = await import('./+page.server.ts');
		getAuthDb().run("UPDATE invite SET redeemed_at = ?1, redeemed_by = 'someone'", [Date.now()]);
		const r = await actions.redeemAsNew!(
			actionEvent(token, { email: 'r@x.test', password: 'password123', name: 'R' })
		);
		expect((r as { status: number }).status).toBe(410);
	});

	test('existing-email collision → 409 with sign-in-to-claim copy', async () => {
		await getAuth();
		const db = getAuthDb();
		db.run(
			"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('u-1', 'taken@x.test', 'T', 1, ?1, ?1, 0)",
			[Date.now()]
		);
		const token = await freshInvite();
		const { actions } = await import('./+page.server.ts');
		const r = await actions.redeemAsNew!(
			actionEvent(token, { email: 'taken@x.test', password: 'password123', name: 'T2' })
		);
		expect((r as { status: number }).status).toBe(409);
		const data = (r as { data: { redeem: { error: string } } }).data;
		expect(data.redeem.error).toMatch(/sign in/i);
	});

	test('password too short → 400', async () => {
		const token = await freshInvite();
		const { actions } = await import('./+page.server.ts');
		const r = await actions.redeemAsNew!(actionEvent(token, { email: 'a@x.test', password: 'short' }));
		expect((r as { status: number }).status).toBe(400);
	});
});

function actionEventWithUser(
	token: string,
	user: { id: string; email: string; isInstallAdmin: boolean },
	fields: Record<string, string> = {}
) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		params: { token },
		locals: { user, access: null, role: null },
		request: { formData: async () => fd, headers: new Headers() },
		setHeaders: () => {},
		url: new URL(`https://amber.test/admin/invite/${token}`)
	} as unknown as Parameters<
		NonNullable<typeof import('./+page.server.ts').actions.redeemAsCurrent>
	>[0];
}

describe('redeemAsCurrent', () => {
	test('signed-in non-member: inserts member + redeems invite', async () => {
		const token = await freshInvite('editor');
		const db = getAuthDb();
		db.run(
			"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('u-1', 'u@x.test', 'U', 1, ?1, ?1, 0)",
			[Date.now()]
		);
		const { actions } = await import('./+page.server.ts');
		await Promise.resolve(
			actions.redeemAsCurrent!(
				actionEventWithUser(token, { id: 'u-1', email: 'u@x.test', isInstallAdmin: false })
			)
		).catch((e: unknown) => {
			if ((e as { status?: number }).status !== 302) throw e;
		});
		const m = db.query('SELECT role FROM member WHERE user_id = ?1').get('u-1');
		expect((m as { role: string }).role).toBe('editor');
	});

	test('signed-in already-member: 409, no double-membership', async () => {
		const token = await freshInvite('editor');
		const db = getAuthDb();
		db.run(
			"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('u-1', 'u@x.test', 'U', 1, ?1, ?1, 0)",
			[Date.now()]
		);
		db.run(
			"INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES ('m-1', 'u-1', ?1, 'editor', ?2, 'admin')",
			[slug, Date.now()]
		);
		const { actions } = await import('./+page.server.ts');
		const r = await actions.redeemAsCurrent!(
			actionEventWithUser(token, { id: 'u-1', email: 'u@x.test', isInstallAdmin: false })
		);
		expect((r as { status: number }).status).toBe(409);
	});

	test('install-admin: refuses (no-op)', async () => {
		const token = await freshInvite();
		const { actions } = await import('./+page.server.ts');
		const r = await actions.redeemAsCurrent!(
			actionEventWithUser(token, { id: 'admin-1', email: 'a@x.test', isInstallAdmin: true })
		);
		expect((r as { status: number }).status).toBe(400);
	});
});

describe('revokeIfAdmin', () => {
	test('install-admin can revoke from the redemption page', async () => {
		const token = await freshInvite();
		const { actions } = await import('./+page.server.ts');
		await actions.revokeIfAdmin!(
			actionEventWithUser(token, { id: 'admin-1', email: 'a@x.test', isInstallAdmin: true })
		);
		const n = getAuthDb().query('SELECT COUNT(*) AS n FROM invite').get() as { n: number };
		expect(n.n).toBe(0);
	});

	test('non-admin: 403', async () => {
		const token = await freshInvite();
		const { actions } = await import('./+page.server.ts');
		const r = await actions.revokeIfAdmin!(
			actionEventWithUser(token, { id: 'u-1', email: 'u@x.test', isInstallAdmin: false })
		);
		expect((r as { status: number }).status).toBe(403);
	});
});
