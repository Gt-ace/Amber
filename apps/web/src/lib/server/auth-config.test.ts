import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getMigrations } from 'better-auth/db/migration';
import { buildAuth, resolveGoogleEnv } from './auth-config.ts';
import { inviteContext } from './invite-context.ts';
import { insertInvite } from './invites.ts';
import { applyAmberAuthMigrations } from './auth-migrations.ts';

/** Build auth + run both better-auth and Amber migrations. Needed for any test that calls auth.api.*. */
async function buildAndMigrateAuth(opts: Parameters<typeof buildAuth>[0]) {
	const { auth, db } = buildAuth(opts);
	const { runMigrations } = await getMigrations(auth.options);
	await runMigrations();
	applyAmberAuthMigrations(db);
	return { auth, db };
}

function tmpAuthDb(): { dbPath: string; cleanup: () => void } {
	const dir = mkdtempSync(join(tmpdir(), 'amber-auth-cfg-'));
	return {
		dbPath: join(dir, 'auth.db'),
		cleanup: () => rmSync(dir, { recursive: true, force: true })
	};
}

describe('resolveGoogleEnv', () => {
	test('returns null when neither var is set', () => {
		expect(resolveGoogleEnv({})).toBeNull();
	});

	test('returns the pair when both vars are set', () => {
		const out = resolveGoogleEnv({
			AMBER_GOOGLE_CLIENT_ID: 'id',
			AMBER_GOOGLE_CLIENT_SECRET: 'secret'
		} as NodeJS.ProcessEnv);
		expect(out).toEqual({ clientId: 'id', clientSecret: 'secret' });
	});

	test('throws when only id is set', () => {
		expect(() => resolveGoogleEnv({ AMBER_GOOGLE_CLIENT_ID: 'id' } as NodeJS.ProcessEnv)).toThrow(
			/Google OAuth/
		);
	});

	test('throws when only secret is set', () => {
		expect(() =>
			resolveGoogleEnv({ AMBER_GOOGLE_CLIENT_SECRET: 's' } as NodeJS.ProcessEnv)
		).toThrow(/Google OAuth/);
	});
});

describe('buildAuth', () => {
	const cleanups: Array<() => void> = [];
	afterEach(() => {
		for (const c of cleanups.splice(0)) c();
	});

	test('throws when AMBER_AUTH_SECRET is unset/empty', () => {
		const { dbPath, cleanup } = tmpAuthDb();
		cleanups.push(cleanup);
		expect(() =>
			buildAuth({ dbPath, secret: '', publicUrl: 'http://localhost:3000', google: null })
		).toThrow(/AMBER_AUTH_SECRET/);
	});

	test('throws when AMBER_PUBLIC_URL is unset/empty', () => {
		const { dbPath, cleanup } = tmpAuthDb();
		cleanups.push(cleanup);
		const prev = process.env.AMBER_PUBLIC_URL;
		delete process.env.AMBER_PUBLIC_URL;
		try {
			expect(() =>
				buildAuth({ dbPath, secret: 'x'.repeat(32), publicUrl: '', google: null })
			).toThrow(/AMBER_PUBLIC_URL/);
		} finally {
			if (prev !== undefined) process.env.AMBER_PUBLIC_URL = prev;
		}
	});

	test('builds when secret is supplied and google is null', () => {
		const { dbPath, cleanup } = tmpAuthDb();
		cleanups.push(cleanup);
		const { auth, db } = buildAuth({
			dbPath,
			secret: 'x'.repeat(32),
			publicUrl: 'http://localhost:3000',
			google: null
		});
		expect(auth).toBeDefined();
		expect(auth.options.socialProviders).toBeUndefined();
		db.close();
	});

	test('registers the Google provider when both vars are supplied', () => {
		const { dbPath, cleanup } = tmpAuthDb();
		cleanups.push(cleanup);
		const { auth, db } = buildAuth({
			dbPath,
			secret: 'x'.repeat(32),
			publicUrl: 'http://localhost:3000',
			google: { clientId: 'gid', clientSecret: 'gsecret' }
		});
		const google = auth.options.socialProviders?.google as
			| { clientId: string; clientSecret: string }
			| undefined;
		expect(google).toBeDefined();
		expect(google?.clientId).toBe('gid');
		db.close();
	});
});

describe('user-create hook with inviteContext', () => {
	const cleanups: Array<() => void> = [];
	afterEach(() => {
		for (const c of cleanups.splice(0)) c();
	});

	test('with no context and ≥1 user → reject', async () => {
		const { dbPath, cleanup } = tmpAuthDb();
		cleanups.push(cleanup);
		const { auth, db } = await buildAndMigrateAuth({
			dbPath,
			secret: 'x'.repeat(32),
			publicUrl: 'https://amber.test',
			google: null
		});
		await auth.api.signUpEmail({
			body: { email: 'a@x.test', password: 'password123', name: 'A' },
			headers: new Headers()
		});
		await expect(
			auth.api.signUpEmail({
				body: { email: 'b@x.test', password: 'password123', name: 'B' },
				headers: new Headers()
			})
		).rejects.toThrow();
		db.close();
	});

	test('with valid pending invite in context → allow', async () => {
		const { dbPath, cleanup } = tmpAuthDb();
		cleanups.push(cleanup);
		const { auth, db } = await buildAndMigrateAuth({
			dbPath,
			secret: 'x'.repeat(32),
			publicUrl: 'https://amber.test',
			google: null
		});
		await auth.api.signUpEmail({
			body: { email: 'admin@x.test', password: 'password123', name: 'admin' },
			headers: new Headers()
		});
		const { id: inviteId } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin'
		});
		await inviteContext.run({ pendingInviteId: inviteId }, async () => {
			await auth.api.signUpEmail({
				body: { email: 'c@x.test', password: 'password123', name: 'C' },
				headers: new Headers()
			});
		});
		const n = db.query('SELECT COUNT(*) AS n FROM user').get() as { n: number };
		expect(n.n).toBe(2);
		db.close();
	});

	test('with expired invite in context → reject', async () => {
		const { dbPath, cleanup } = tmpAuthDb();
		cleanups.push(cleanup);
		const { auth, db } = await buildAndMigrateAuth({
			dbPath,
			secret: 'x'.repeat(32),
			publicUrl: 'https://amber.test',
			google: null
		});
		await auth.api.signUpEmail({
			body: { email: 'admin@x.test', password: 'password123', name: 'admin' },
			headers: new Headers()
		});
		const { id: inviteId } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin'
		});
		db.run('UPDATE invite SET expires_at = 0 WHERE id = ?1', [inviteId]);
		await expect(
			inviteContext.run({ pendingInviteId: inviteId }, async () => {
				await auth.api.signUpEmail({
					body: { email: 'd@x.test', password: 'password123', name: 'D' },
					headers: new Headers()
				});
			})
		).rejects.toThrow();
		db.close();
	});

	test('with redeemed invite in context → reject', async () => {
		const { dbPath, cleanup } = tmpAuthDb();
		cleanups.push(cleanup);
		const { auth, db } = await buildAndMigrateAuth({
			dbPath,
			secret: 'x'.repeat(32),
			publicUrl: 'https://amber.test',
			google: null
		});
		await auth.api.signUpEmail({
			body: { email: 'admin@x.test', password: 'password123', name: 'admin' },
			headers: new Headers()
		});
		const { id: inviteId } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin'
		});
		db.run('UPDATE invite SET redeemed_at = ?1, redeemed_by = ?2 WHERE id = ?3', [
			Date.now(),
			'someone-else',
			inviteId
		]);
		await expect(
			inviteContext.run({ pendingInviteId: inviteId }, async () => {
				await auth.api.signUpEmail({
					body: { email: 'e@x.test', password: 'password123', name: 'E' },
					headers: new Headers()
				});
			})
		).rejects.toThrow();
		db.close();
	});
});
