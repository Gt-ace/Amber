/**
 * /admin/setup load + action coverage (spec §3, §11).
 *
 * Each test gets a throwaway auth.db via mkdtemp + AMBER_SPACE_PATH, and a
 * fresh module import so the auth singleton it builds is scoped to the
 * test. The race-condition test seeds an admin between `load` and `action`
 * to exercise the second-pass count check.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../../../../../fixtures/example-space/', import.meta.url));

let workDir: string;
let load: typeof import('./+page.server.ts').load;
let actions: typeof import('./+page.server.ts').actions;
let resetSingleton: () => void;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-setup-'));
	mkdirSync(join(workDir, '.amber'), { recursive: true });
	// Setup needs a real Space too because the action calls auth.api.signUpEmail
	// which runs through the hook system — but we never call any space stuff.
	// Still, $lib/server/space gets imported transitively; give it a valid path.
	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	// Copy fixture content so the Space init doesn't fail on an empty dir.
	const { cpSync } = await import('node:fs');
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });

	const mod = await import('./+page.server.ts');
	load = mod.load;
	actions = mod.actions;
	resetSingleton = (await import('$lib/server/auth-config'))._resetAuthSingleton;
});

afterEach(async () => {
	const { getSpace } = await import('$lib/server/space');
	try {
		getSpace().close();
	} catch {
		/* getSpace may be torn down already */
	}
	resetSingleton();
	rmSync(workDir, { recursive: true, force: true });
});

function loadEvent() {
	return {} as unknown as Parameters<typeof load>[0];
}

function formEvent(fields: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		request: { formData: async () => fd, headers: new Headers() }
	} as unknown as Parameters<NonNullable<typeof actions.default>>[0];
}

describe('/admin/setup load', () => {
	test('renders the form when no admin exists', async () => {
		const data = await load(loadEvent());
		expect(data).toEqual({ googleEnabled: false });
	});

	test('404s once an admin has been claimed', async () => {
		// Run the action successfully to create the admin row.
		await Promise.resolve(
			actions.default!(formEvent({ email: 'a@x.test', password: 'password123', name: 'A' }))
		).catch((e: unknown) => {
			// Action redirects on success; tolerate it.
			if ((e as { status?: number }).status !== 302) throw e;
		});

		try {
			await load(loadEvent());
			expect.unreachable('load should have 404d');
		} catch (e) {
			expect((e as { status: number }).status).toBe(404);
		}
	});
});

describe('/admin/setup action', () => {
	test('inline error on missing fields', async () => {
		const r = (await actions.default!(formEvent({ email: '', password: '' }))) as {
			status: number;
			data: { error: string };
		};
		expect(r.status).toBe(400);
		expect(r.data.error).toMatch(/required/i);
	});

	test('inline error on short password', async () => {
		const r = (await actions.default!(
			formEvent({ email: 'a@x.test', password: 'short', name: 'A' })
		)) as { status: number; data: { error: string } };
		expect(r.status).toBe(400);
		expect(r.data.error).toMatch(/8 characters/);
	});

	test('first call creates the admin and redirects to /admin', async () => {
		try {
			await actions.default!(
				formEvent({ email: 'admin@x.test', password: 'password123', name: 'Admin' })
			);
			expect.unreachable('the action should have redirected');
		} catch (e) {
			const r = e as { status: number; location: string };
			expect(r.status).toBe(302);
			expect(r.location).toBe('/admin');
		}
	});

	test('409-style fail when an admin already exists (race re-check)', async () => {
		// Seed an admin via the first call.
		await Promise.resolve(
			actions.default!(formEvent({ email: 'a@x.test', password: 'password123', name: 'A' }))
		).catch((e: unknown) => {
			if ((e as { status?: number }).status !== 302) throw e;
		});

		// Second call should be rejected by the in-action count check.
		const r = (await actions.default!(
			formEvent({ email: 'b@x.test', password: 'password123', name: 'B' })
		)) as { status: number; data: { error: string } };
		expect(r.status).toBe(409);
		expect(r.data.error).toMatch(/already complete/i);
	});

	test('deleteUserCascade removes the orphan user and its session/account rows', async () => {
		// Create the install admin so the real better-auth schema (user/session/
		// account) is migrated into the singleton db.
		await Promise.resolve(
			actions.default!(formEvent({ email: 'admin@x.test', password: 'password123', name: 'Admin' }))
		).catch((e: unknown) => {
			if ((e as { status?: number }).status !== 302) throw e;
		});

		const { getAuth, getAuthDb } = await import('$lib/server/auth-config');
		const { insertInvite } = await import('$lib/server/invites');
		const { inviteContext } = await import('$lib/server/invite-context');
		const { deleteUserCascade } = await import('$lib/server/permissions');

		const auth = await getAuth();
		const db = getAuthDb();
		// A real second account, created the way an invited user would be — gives
		// us genuine user + session + account rows to cascade-delete.
		const { id: inviteId } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin'
		});
		await inviteContext.run({ pendingInviteId: inviteId }, async () => {
			await auth.api.signUpEmail({
				body: { email: 'orphan@x.test', password: 'password123', name: 'Orphan' },
				headers: new Headers()
			});
		});

		const orphan = db.query('SELECT id FROM user WHERE email = ?').get('orphan@x.test') as
			| { id: string }
			| undefined;
		expect(orphan).toBeTruthy();
		const sessions = db
			.query('SELECT COUNT(*) AS n FROM session WHERE userId = ?')
			.get(orphan!.id) as { n: number };
		expect(sessions.n).toBeGreaterThanOrEqual(1);

		deleteUserCascade(orphan!.id);

		expect(db.query('SELECT id FROM user WHERE email = ?').get('orphan@x.test')).toBeNull();
		expect(
			(
				db.query('SELECT COUNT(*) AS n FROM session WHERE userId = ?').get(orphan!.id) as {
					n: number;
				}
			).n
		).toBe(0);
		expect(
			(
				db.query('SELECT COUNT(*) AS n FROM account WHERE userId = ?').get(orphan!.id) as {
					n: number;
				}
			).n
		).toBe(0);
		// The admin row is untouched.
		expect(db.query('SELECT id FROM user WHERE email = ?').get('admin@x.test')).toBeTruthy();
	});

	test('sets isInstallAdmin = 1 on the created user row', async () => {
		await Promise.resolve(
			actions.default!(formEvent({ email: 'first@x.test', password: 'password123', name: 'First' }))
		).catch((e: unknown) => {
			if ((e as { status?: number }).status !== 302) throw e;
		});

		const { getAuthDb } = await import('$lib/server/auth-config');
		const row = getAuthDb()
			.query('SELECT isInstallAdmin FROM user WHERE email = ?')
			.get('first@x.test') as { isInstallAdmin: number } | undefined;
		expect(row?.isInstallAdmin).toBe(1);
	});
});
