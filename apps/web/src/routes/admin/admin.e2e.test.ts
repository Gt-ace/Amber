/**
 * Browser-level admin smoke. Opt-in: only runs when `AMBER_E2E` is set (see
 * apps/web/CLAUDE.md → "End-to-end smoke"). Builds the production bundle,
 * boots it under Bun with AMBER_AUTH_SECRET against a throwaway copy of the
 * example-space fixture, then in a real Chromium:
 *
 *   - first-run: navigates to /admin → expects /admin/setup redirect →
 *     claims the admin via the form → lands in /admin and sees the page list.
 *   - editor: opens /admin/edit/about and asserts the Crepe editor mounted.
 *   - PUT save: posts a body-only save with the signed session cookie and
 *     asserts 200 + a returned hash.
 *   - sign-out round-trip: signs out, hits /admin/edit/about, expects a
 *     redirect to /admin/login?next=..., signs back in, lands on
 *     /admin/edit/about.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { chromium, type Browser, type BrowserContext } from 'playwright';

const APP_ROOT = fileURLToPath(new URL('../../../', import.meta.url)); // apps/web/
const BUNDLE = resolve(APP_ROOT, 'build/index.js');
const FIXTURE = resolve(APP_ROOT, 'fixtures/example-space');

const ADMIN_EMAIL = 'admin@x.test';
const ADMIN_PASSWORD = 'password123';

function freePort(): Promise<number> {
	return new Promise((res, rej) => {
		const srv = createServer();
		srv.on('error', rej);
		srv.listen(0, '127.0.0.1', () => {
			const addr = srv.address();
			if (addr && typeof addr === 'object') {
				const { port } = addr;
				srv.close(() => res(port));
			} else {
				srv.close(() => rej(new Error('could not allocate a port')));
			}
		});
	});
}

async function waitForServer(url: string, timeoutMs = 15_000): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		try {
			const r = await fetch(url);
			if (r.status > 0) return;
		} catch {
			// not up yet
		}
		if (Date.now() > deadline) throw new Error(`server at ${url} did not come up`);
		await new Promise((r) => setTimeout(r, 200));
	}
}

let server: ChildProcess;
let browser: Browser;
let signedInContext: BrowserContext;
let base: string;
let workDir: string;

beforeAll(async () => {
	// `--bun` forces bun to interpret vite's node shebang itself, so the
	// build picks up `bun:sqlite`. Inside the bun Docker image there's no
	// node anyway, so the flag is harmless there.
	execFileSync('bun', ['--bun', 'run', 'build'], { cwd: APP_ROOT, stdio: 'inherit' });

	workDir = mkdtempSync(join(tmpdir(), 'amber-admin-e2e-'));
	cpSync(FIXTURE, workDir, { recursive: true });

	const port = await freePort();
	base = `http://127.0.0.1:${port}`;
	server = spawn('bun', [BUNDLE], {
		cwd: APP_ROOT,
		env: {
			...process.env,
			AMBER_SPACE_PATH: workDir,
			AMBER_AUTH_SECRET: 'e2e-secret-' + 'x'.repeat(32),
			AMBER_PUBLIC_URL: base,
			// SvelteKit's adapter-node defaults event.url.protocol to https
			// when ORIGIN is unset, which breaks better-auth's origin check
			// against an http:// AMBER_PUBLIC_URL. Pinning ORIGIN to the
			// listening address keeps them in sync.
			ORIGIN: base,
			PORT: String(port),
			HOST: '127.0.0.1'
		},
		stdio: 'inherit'
	});
	await waitForServer(base + '/admin/setup');
	browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
	await browser?.close();
	server?.kill('SIGTERM');
	await new Promise((r) => setTimeout(r, 300));
	if (server && !server.killed) server.kill('SIGKILL');
	rmSync(workDir, { recursive: true, force: true });
});

describe('admin surface smoke (AMBER_E2E)', () => {
	test('first-run: /admin redirects to /admin/setup; the form claims the admin', async () => {
		const context = await browser.newContext();
		const page = await context.newPage();
		try {
			const response = await page.goto(base + '/admin', { waitUntil: 'networkidle' });
			expect(page.url()).toBe(base + '/admin/setup');
			expect(response?.status()).toBeLessThan(400);

			await page.fill('input[name="email"]', ADMIN_EMAIL);
			await page.fill('input[name="password"]', ADMIN_PASSWORD);
			await page.click('button[type="submit"]');
			await page.waitForURL(base + '/admin', { timeout: 15_000 });

			// Reuse this context for later authenticated steps.
			signedInContext = context;
		} catch (e) {
			await context.close();
			throw e;
		}
	}, 60_000);

	test('the editor mounts Crepe for a page', async () => {
		const page = await signedInContext.newPage();
		try {
			await page.goto(base + '/admin/edit/about', { waitUntil: 'networkidle' });
			await page.waitForSelector('.amber-body [contenteditable="true"]', { timeout: 20_000 });
			expect(await page.locator('.amber-body [contenteditable="true"]').count()).toBe(1);
		} finally {
			await page.close();
		}
	}, 60_000);

	test('the PUT endpoint saves a body-only change (with session cookie)', async () => {
		const cookies = await signedInContext.cookies();
		const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
		const res = await fetch(base + '/admin/api/page/about', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'If-Match': '*',
				cookie: cookieHeader
			},
			body: JSON.stringify({ body: 'Smoke-tested body.\n' })
		});
		expect(res.status).toBe(200);
		const out = (await res.json()) as { hash: string };
		expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
	}, 60_000);

	test('sign-out then login round-trip preserves ?next=', async () => {
		const context = await browser.newContext({
			storageState: await signedInContext.storageState()
		});
		const page = await context.newPage();
		try {
			// Sign out via the chrome button (POSTs to /api/auth/sign-out).
			await page.goto(base + '/admin', { waitUntil: 'networkidle' });
			await page.click('button.amber-signout-button');
			await page.waitForLoadState('networkidle');

			// Now navigate to a guarded route — should bounce to /admin/login.
			const response = await page.goto(base + '/admin/edit/about', { waitUntil: 'networkidle' });
			expect(response?.status()).toBeLessThan(400);
			expect(page.url()).toContain('/admin/login');
			expect(page.url()).toContain(encodeURIComponent('/admin/edit/about'));

			// Sign back in.
			await page.fill('input[name="email"]', ADMIN_EMAIL);
			await page.fill('input[name="password"]', ADMIN_PASSWORD);
			await page.click('button[type="submit"]');
			await page.waitForURL(base + '/admin/edit/about', { timeout: 15_000 });
		} finally {
			await context.close();
		}
	}, 60_000);
});
