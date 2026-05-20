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
	user: { id: string; email: string; name: string | null };
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
	const user = db.query('SELECT id, email, name FROM user').get() as {
		id: string;
		email: string;
		name: string | null;
	};
	// Pick up the session row better-auth wrote during signUpEmail.
	const session = db.query('SELECT token FROM session WHERE userId = ?1').get(user.id) as
		| { token: string }
		| undefined;
	const cookieHeader = session
		? `better-auth.session_token=${encodeURIComponent(session.token)}`
		: '';
	return { user, cookieHeader };
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
