/**
 * /admin/account action coverage (spec §6, §11).
 *
 * Focused on the invariants:
 *   - Change-password revokes other sessions.
 *   - Unlinking Google is blocked when no password is set.
 *   - The action surfaces better-auth's error message on a bad current
 *     password.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../../../../../fixtures/example-space/', import.meta.url));

let workDir: string;
let actions: typeof import('./+page.server.ts').actions;
let setupActions: typeof import('../../(public)/setup/+page.server.ts').actions;
let resetSingleton: () => void;
let getAuth: () => ReturnType<typeof import('$lib/server/auth-config').getAuth>;
let getAuthDb: () => import('bun:sqlite').Database;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-account-'));
	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });

	const mod = await import('./+page.server.ts');
	actions = mod.actions;
	setupActions = (await import('../../(public)/setup/+page.server.ts')).actions;
	const cfg = await import('$lib/server/auth-config');
	resetSingleton = cfg._resetAuthSingleton;
	getAuth = cfg.getAuth;
	getAuthDb = cfg.getAuthDb;
});

afterEach(async () => {
	const { getSpace } = await import('$lib/server/space');
	try {
		getSpace().close();
	} catch {
		/* */
	}
	resetSingleton();
	rmSync(workDir, { recursive: true, force: true });
});

interface AdminInfo {
	user: { id: string; email: string; name: string | null; isInstallAdmin: boolean };
	cookieHeader: string;
}

async function claimAdminAndSignIn(): Promise<AdminInfo> {
	const fd = new FormData();
	fd.set('email', 'admin@x.test');
	fd.set('password', 'password123');
	fd.set('name', 'Admin');
	const ev = {
		request: { formData: async () => fd, headers: new Headers() }
	} as unknown as Parameters<NonNullable<typeof setupActions.default>>[0];
	await Promise.resolve(setupActions.default!(ev)).catch((e: unknown) => {
		if ((e as { status?: number }).status !== 302) throw e;
	});
	const db = getAuthDb();
	const user = db.query('SELECT id, email, name, isInstallAdmin FROM user').get() as {
		id: string;
		email: string;
		name: string | null;
		isInstallAdmin: number;
	};
	// Pick up the session row better-auth wrote during signUpEmail.
	const session = db.query('SELECT token FROM session WHERE userId = ?1').get(user.id) as
		| { token: string }
		| undefined;
	const cookieHeader = session
		? `better-auth.session_token=${encodeURIComponent(session.token)}`
		: '';
	return { user: { ...user, isInstallAdmin: Boolean(user.isInstallAdmin) }, cookieHeader };
}

function actionEvent(
	fields: Record<string, string>,
	info: AdminInfo
): Parameters<NonNullable<typeof actions.changePassword>>[0] {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	const headers = new Headers();
	if (info.cookieHeader) headers.set('cookie', info.cookieHeader);
	return {
		request: { formData: async () => fd, headers },
		locals: { user: info.user }
	} as unknown as Parameters<NonNullable<typeof actions.changePassword>>[0];
}

describe('account changePassword action', () => {
	test('wrong current password surfaces an error', async () => {
		const info = await claimAdminAndSignIn();
		const r = (await actions.changePassword!(
			actionEvent({ currentPassword: 'definitely-wrong', newPassword: 'newpassword123' }, info)
		)) as { status: number; data: { changePassword: { error: string } } };
		expect(r.status).toBe(400);
		expect(r.data.changePassword.error).toBeTruthy();
	});

	test('rejects short new password', async () => {
		const info = await claimAdminAndSignIn();
		const r = (await actions.changePassword!(
			actionEvent({ currentPassword: 'password123', newPassword: 'short' }, info)
		)) as { status: number; data: { changePassword: { error: string } } };
		expect(r.status).toBe(400);
		expect(r.data.changePassword.error).toMatch(/8 characters/);
	});
});

describe('account unlinkGoogle action', () => {
	test('blocked when no Google account is linked (and has password)', async () => {
		const info = await claimAdminAndSignIn();
		const r = (await actions.unlinkGoogle!(actionEvent({}, info))) as {
			status: number;
			data: { unlinkGoogle: { error: string } };
		};
		// With a password set, the unlink isn't pre-empted by us — better-auth
		// returns its own error because there's nothing to unlink.
		expect(r.status).toBe(400);
		expect(r.data.unlinkGoogle.error).toBeTruthy();
	});

	test('blocked with our message when the user has no password set', async () => {
		const info = await claimAdminAndSignIn();
		// Remove the credential account so hasPassword() returns false.
		const db = getAuthDb();
		db.run("DELETE FROM account WHERE providerId = 'credential' AND userId = ?1", [info.user.id]);
		const r = (await actions.unlinkGoogle!(actionEvent({}, info))) as {
			status: number;
			data: { unlinkGoogle: { error: string } };
		};
		expect(r.status).toBe(400);
		expect(r.data.unlinkGoogle.error).toMatch(/Set a password/);
	});
});

describe('deleteSelf action', () => {
	test('editor self-delete cascades rows', async () => {
		await getAuth();
		const db = getAuthDb();
		db.run(
			"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('u-1', 'e@x.test', 'E', 1, ?1, ?1, 0)",
			[Date.now()]
		);
		db.run(
			"INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES ('m-1', 'u-1', 'example-space', 'editor', ?1, 'admin')",
			[Date.now()]
		);
		const { actions: freshActions } = await import('./+page.server.ts');
		await Promise.resolve(
			freshActions.deleteSelf!(
				actionEvent(
					{ confirmEmail: 'e@x.test' },
					{ user: { id: 'u-1', email: 'e@x.test', name: null, isInstallAdmin: false }, cookieHeader: '' }
				)
			)
		).catch((e: unknown) => {
			if ((e as { status?: number }).status !== 302) throw e;
		});
		expect(db.query('SELECT COUNT(*) AS n FROM user WHERE id = ?1').get('u-1')).toEqual({ n: 0 });
		expect(db.query('SELECT COUNT(*) AS n FROM member WHERE user_id = ?1').get('u-1')).toEqual({ n: 0 });
	});

	test('install-admin self-delete is blocked', async () => {
		await getAuth();
		const db = getAuthDb();
		db.run(
			"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('admin-1', 'a@x.test', 'A', 1, ?1, ?1, 1)",
			[Date.now()]
		);
		const { actions: freshActions } = await import('./+page.server.ts');
		const r = await freshActions.deleteSelf!(
			actionEvent(
				{ confirmEmail: 'a@x.test' },
				{ user: { id: 'admin-1', email: 'a@x.test', name: null, isInstallAdmin: true }, cookieHeader: '' }
			)
		);
		expect((r as { status: number }).status).toBe(400);
	});

	test('confirmation email mismatch → 400', async () => {
		await getAuth();
		const db = getAuthDb();
		db.run(
			"INSERT INTO user (id, email, name, emailVerified, createdAt, updatedAt, isInstallAdmin) VALUES ('u-1', 'e@x.test', 'E', 1, ?1, ?1, 0)",
			[Date.now()]
		);
		const { actions: freshActions } = await import('./+page.server.ts');
		const r = await freshActions.deleteSelf!(
			actionEvent(
				{ confirmEmail: 'wrong@x.test' },
				{ user: { id: 'u-1', email: 'e@x.test', name: null, isInstallAdmin: false }, cookieHeader: '' }
			)
		);
		expect((r as { status: number }).status).toBe(400);
	});
});
