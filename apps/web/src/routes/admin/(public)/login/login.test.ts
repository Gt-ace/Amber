/**
 * /admin/login load + action coverage (spec §4, §11).
 *
 * Builds a throwaway auth.db per test, seeds an admin via the setup action
 * to make login meaningful, then exercises the login action.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../../../../../fixtures/example-space/', import.meta.url));

let workDir: string;
let load: typeof import('./+page.server.ts').load;
let actions: typeof import('./+page.server.ts').actions;
let setupActions: typeof import('../setup/+page.server.ts').actions;
let resetSingleton: () => void;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-login-'));
	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });

	const loginMod = await import('./+page.server.ts');
	load = loginMod.load;
	actions = loginMod.actions;
	const setupMod = await import('../setup/+page.server.ts');
	setupActions = setupMod.actions;
	resetSingleton = (await import('$lib/server/auth-config'))._resetAuthSingleton;
});

afterEach(async () => {
	const { getSpace } = await import('$lib/server/space');
	try {
		getSpace().close();
	} catch {
		/* already closed */
	}
	resetSingleton();
	rmSync(workDir, { recursive: true, force: true });
});

function loadEvent(opts: { user?: object | null; nextParam?: string } = {}) {
	const search = opts.nextParam ? `?next=${encodeURIComponent(opts.nextParam)}` : '';
	const url = new URL(`http://x/admin/login${search}`);
	return {
		locals: { user: opts.user ?? null },
		url
	} as unknown as Parameters<typeof load>[0];
}

function actionEvent(fields: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.set(k, v);
	return {
		request: { formData: async () => fd, headers: new Headers() }
	} as unknown as Parameters<NonNullable<typeof actions.default>>[0];
}

async function claimAdmin() {
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
}

describe('/admin/login load', () => {
	test('redirects to /admin/setup when no admin exists', async () => {
		try {
			await load(loadEvent());
			expect.unreachable('should have redirected to /admin/setup');
		} catch (e) {
			const r = e as { status: number; location: string };
			expect(r.status).toBe(302);
			expect(r.location).toBe('/admin/setup');
		}
	});

	test('renders the form once an admin exists', async () => {
		await claimAdmin();
		const data = await load(loadEvent());
		expect(data).toEqual({ googleEnabled: false, next: null });
	});

	test('redirects authenticated requests away from login', async () => {
		await claimAdmin();
		try {
			await load(loadEvent({ user: { id: 'u', email: 'a@x' } }));
			expect.unreachable('authenticated load should redirect');
		} catch (e) {
			const r = e as { status: number; location: string };
			expect(r.status).toBe(302);
			expect(r.location).toBe('/admin');
		}
	});
});

describe('/admin/login action', () => {
	test('rejects empty inputs', async () => {
		await claimAdmin();
		const r = (await actions.default!(actionEvent({ email: '', password: '' }))) as {
			status: number;
			data: { error: string };
		};
		expect(r.status).toBe(400);
		expect(r.data.error).toMatch(/required/i);
	});

	test('rejects wrong password with the same generic message (no user-existence leak)', async () => {
		await claimAdmin();
		const wrongPw = (await actions.default!(
			actionEvent({ email: 'admin@x.test', password: 'wrong-one' })
		)) as { status: number; data: { error: string } };
		const wrongEmail = (await actions.default!(
			actionEvent({ email: 'nobody@x.test', password: 'whatever123' })
		)) as { status: number; data: { error: string } };
		expect(wrongPw.status).toBe(401);
		expect(wrongEmail.status).toBe(401);
		expect(wrongPw.data.error).toBe(wrongEmail.data.error);
		expect(wrongPw.data.error).toMatch(/invalid/i);
	});

	test('open-redirect attempts in ?next= fall back to /admin', async () => {
		await claimAdmin();
		try {
			await actions.default!(
				actionEvent({
					email: 'admin@x.test',
					password: 'password123',
					next: '//evil.example.com/'
				})
			);
			expect.unreachable('expected a redirect');
		} catch (e) {
			const r = e as { status: number; location: string };
			expect(r.status).toBe(302);
			expect(r.location).toBe('/admin');
		}
	});

	test('honours a valid same-origin ?next=', async () => {
		await claimAdmin();
		try {
			await actions.default!(
				actionEvent({ email: 'admin@x.test', password: 'password123', next: '/admin/edit/about' })
			);
			expect.unreachable('expected a redirect');
		} catch (e) {
			const r = e as { status: number; location: string };
			expect(r.status).toBe(302);
			expect(r.location).toBe('/admin/edit/about');
		}
	});
});
