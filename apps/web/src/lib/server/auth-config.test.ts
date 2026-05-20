import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAuth, resolveGoogleEnv } from './auth-config.ts';

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
		expect(() => buildAuth({ dbPath, secret: '', google: null })).toThrow(/AMBER_AUTH_SECRET/);
	});

	test('builds when secret is supplied and google is null', () => {
		const { dbPath, cleanup } = tmpAuthDb();
		cleanups.push(cleanup);
		const { auth, db } = buildAuth({ dbPath, secret: 'x'.repeat(32), google: null });
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
