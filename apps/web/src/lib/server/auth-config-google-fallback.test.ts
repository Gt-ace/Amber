/**
 * Google-OAuth invite-state fallback (sub-4 follow-up). The
 * inviteContext-based path is covered in auth-config.test.ts; this file
 * exercises the *other* arm of the user-create hook — the one that runs
 * during better-auth's social-callback, where the redemption action's
 * AsyncLocalStorage is gone and the invite-id has to be recovered from
 * the gstate query param via SvelteKit's getRequestEvent().
 *
 * Why a separate file: the test mocks `$app/server.getRequestEvent` at
 * module scope so the hook sees a controllable Request URL. Doing that
 * inside auth-config.test.ts would also change the "throws
 * getRequestEvent" trail that the existing rejection tests sit on top of;
 * the existing tests still pass under this mock (no-gstate → falls
 * through to the FORBIDDEN rejection, same observable outcome) but
 * keeping the mock scoped to this file makes the intent obvious.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMigrations } from 'better-auth/db/migration';
import { buildAuth } from './auth-config';
import { insertInvite } from './invites';
import { signInviteState } from './google-invite-state';
import { applyAmberAuthMigrations } from './auth-migrations';

// Hoisted holder the vi.mock factory can close over. The factory is
// hoisted to the top of the file by vitest's plugin; the holder must be
// hoisted alongside it (plain `let` would be initialised too late).
const mockReq = vi.hoisted(() => ({ url: 'http://amber.test/no-gstate' }));

vi.mock('$app/server', () => ({
	getRequestEvent: () => ({ request: { url: mockReq.url } })
}));

async function buildAndMigrateAuth(opts: Parameters<typeof buildAuth>[0]) {
	const { auth, db } = buildAuth(opts);
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
	applyAmberAuthMigrations(db);
	return { auth, db };
}

function tmpAuthDb(): { dbPath: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'amber-auth-gfall-'));
	return {
		dbPath: join(dir, 'auth.db'),
		cleanup: () => rmSync(dir, { recursive: true, force: true })
	};
}

const PUBLIC_URL = 'https://amber.test';
const SECRET = 'x'.repeat(32);

describe('user-create hook — Google gstate fallback', () => {
	const cleanups: Array<() => void> = [];
	const originalSecret = process.env.AMBER_AUTH_SECRET;

	beforeEach(() => {
		// signInviteState reads AMBER_AUTH_SECRET at call time; the
		// user-create hook's verifyInviteState reads the same env. Pin
		// them together for the test.
		process.env.AMBER_AUTH_SECRET = SECRET;
	});

	afterEach(() => {
		for (const c of cleanups.splice(0)) c();
		mockReq.url = 'http://amber.test/no-gstate';
		if (originalSecret === undefined) delete process.env.AMBER_AUTH_SECRET;
		else process.env.AMBER_AUTH_SECRET = originalSecret;
	});

	async function seedAdminAndInvite(): Promise<{
		auth: Awaited<ReturnType<typeof buildAndMigrateAuth>>['auth'];
		db: Awaited<ReturnType<typeof buildAndMigrateAuth>>['db'];
		inviteId: string;
	}> {
		const { dbPath, cleanup } = tmpAuthDb();
		cleanups.push(cleanup);
		const { auth, db } = await buildAndMigrateAuth({
			dbPath,
			secret: SECRET,
			publicUrl: PUBLIC_URL,
			google: null
		});
		// First-user (n=0) path — no invite needed for the install-admin.
		await auth.api.signUpEmail({
			body: { email: 'admin@x.test', password: 'password123', name: 'admin' },
			headers: new Headers()
		});
		const { id: inviteId } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin'
		});
		return { auth, db, inviteId };
	}

	test('valid gstate + pending invite → user is created (no inviteContext needed)', async () => {
		const { auth, db, inviteId } = await seedAdminAndInvite();
		const state = signInviteState(inviteId);
		mockReq.url = `${PUBLIC_URL}/api/auth/callback/google?gstate=${state}`;

		// No inviteContext.run(...) wrapper. The hook's first multi-user
		// branch (inviteContext.getStore()) returns null, so we fall through
		// to the getRequestEvent path. A valid gstate + still-pending invite
		// is the green light.
		await auth.api.signUpEmail({
			body: { email: 'g@x.test', password: 'password123', name: 'G' },
			headers: new Headers()
		});
		const n = db.query('SELECT COUNT(*) AS n FROM user').get() as { n: number };
		expect(n.n).toBe(2);
		db.close();
	});

	test('tampered gstate → reject', async () => {
		const { auth, db, inviteId } = await seedAdminAndInvite();
		const state = signInviteState(inviteId);
		// Flip the signature suffix.
		const tampered = state.slice(0, -2) + 'AA';
		mockReq.url = `${PUBLIC_URL}/api/auth/callback/google?gstate=${tampered}`;

		await expect(
			auth.api.signUpEmail({
				body: { email: 'tamper@x.test', password: 'password123', name: 'T' },
				headers: new Headers()
			})
		).rejects.toThrow();
		db.close();
	});

	test('expired invite via gstate → reject', async () => {
		const { auth, db, inviteId } = await seedAdminAndInvite();
		db.run('UPDATE invite SET expires_at = 0 WHERE id = ?1', [inviteId]);
		const state = signInviteState(inviteId);
		mockReq.url = `${PUBLIC_URL}/api/auth/callback/google?gstate=${state}`;

		await expect(
			auth.api.signUpEmail({
				body: { email: 'expired@x.test', password: 'password123', name: 'E' },
				headers: new Headers()
			})
		).rejects.toThrow();
		db.close();
	});

	test('already-redeemed invite via gstate → reject', async () => {
		const { auth, db, inviteId } = await seedAdminAndInvite();
		db.run(
			'UPDATE invite SET redeemed_at = ?1, redeemed_by = ?2 WHERE id = ?3',
			[Date.now(), 'someone-else', inviteId]
		);
		const state = signInviteState(inviteId);
		mockReq.url = `${PUBLIC_URL}/api/auth/callback/google?gstate=${state}`;

		await expect(
			auth.api.signUpEmail({
				body: { email: 'redeemed@x.test', password: 'password123', name: 'R' },
				headers: new Headers()
			})
		).rejects.toThrow();
		db.close();
	});

	test('no gstate on the callback URL → reject (sanity: the fallback only fires when gstate is present)', async () => {
		const { auth, db } = await seedAdminAndInvite();
		mockReq.url = `${PUBLIC_URL}/api/auth/callback/google`;

		await expect(
			auth.api.signUpEmail({
				body: { email: 'nogstate@x.test', password: 'password123', name: 'N' },
				headers: new Headers()
			})
		).rejects.toThrow();
		db.close();
	});
});
