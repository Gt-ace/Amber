/**
 * Browser-level admin smoke. Opt-in: only runs when `AMBER_E2E` is set (see
 * apps/web/CLAUDE.md → "End-to-end smoke"). Builds the production bundle,
 * boots it under Bun with AMBER_AUTH_SECRET against a throwaway copy of the
 * example-space fixture, then in a real Chromium:
 *
 *   - first-run: navigates to /admin → expects /admin/setup redirect →
 *     claims the admin via the form → lands in the per-space picker which
 *     302s to /admin/spaces/example-space (single-space shortcut).
 *   - editor: opens /admin/spaces/example-space/edit/about and asserts the
 *     Crepe editor mounted.
 *   - PUT save: posts a body-only save to the per-space endpoint with the
 *     signed session cookie and asserts 200 + a returned hash.
 *   - shim smoke: confirms the subsystem-2 URLs still 302/308 to the new
 *     per-space URLs (back-compat for bookmarked links).
 *   - sign-out round-trip: signs out, hits a guarded route, expects a
 *     redirect to /admin/login?next=..., signs back in, lands back on it.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve, join, basename } from 'node:path';
import { cpSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
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

async function waitForBodyContaining(
	url: string,
	needle: string,
	timeoutMs = 10_000
): Promise<string> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const body = await (await fetch(url)).text();
		if (body.includes(needle)) return body;
		if (Date.now() > deadline) return body; // return last seen; the assertion reports the miss
		await new Promise((r) => setTimeout(r, 200));
	}
}

let server: ChildProcess;
let browser: Browser;
let signedInContext: BrowserContext;
let base: string;
let workDir: string;
/**
 * The lone space's slug, derived from the tmpdir basename. Single-space
 * mode uses the directory name as the per-space admin slug, so we cannot
 * hard-code "example-space" here (the e2e runs against a `mkdtempSync`
 * copy of the fixture).
 */
let spaceSlug: string;

beforeAll(async () => {
	// `--bun` forces bun to interpret vite's node shebang itself, so the
	// build picks up `bun:sqlite`. Inside the bun Docker image there's no
	// node anyway, so the flag is harmless there.
	execFileSync('bun', ['--bun', 'run', 'build'], { cwd: APP_ROOT, stdio: 'inherit' });

	workDir = mkdtempSync(join(tmpdir(), 'amber-admin-e2e-'));
	cpSync(FIXTURE, workDir, { recursive: true });
	const THEMES_SRC = resolve(APP_ROOT, 'themes');
	cpSync(join(THEMES_SRC, 'amber-default'), join(workDir, 'themes', 'amber-default'), {
		recursive: true
	});
	cpSync(join(THEMES_SRC, 'amber-editorial'), join(workDir, 'themes', 'amber-editorial'), {
		recursive: true
	});
	spaceSlug = basename(workDir);

	const port = await freePort();
	base = `http://127.0.0.1:${port}`;
	server = spawn('bun', [BUNDLE], {
		cwd: APP_ROOT,
		env: {
			...process.env,
			AMBER_SPACE_PATH: workDir,
			AMBER_AUTH_SECRET: 'e2e-secret-' + 'x'.repeat(32),
			AMBER_PUBLIC_URL: base,
			// Half-configured OAuth refuses to boot; pair fake values so the
			// "Continue with Google" button renders for href assertions. We
			// never actually traverse the OAuth dance.
			AMBER_GOOGLE_CLIENT_ID: 'e2e-fake-client-id',
			AMBER_GOOGLE_CLIENT_SECRET: 'e2e-fake-client-secret',
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
			// Setup redirects to /admin; single-space picker 302s straight to
			// the lone space's per-space landing.
			await page.waitForURL(base + '/admin/spaces/' + spaceSlug, { timeout: 15_000 });

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
			await page.goto(base + '/admin/spaces/' + spaceSlug + '/edit/about', {
				waitUntil: 'networkidle'
			});
			await page.waitForSelector('.amber-body [contenteditable="true"]', { timeout: 20_000 });
			expect(await page.locator('.amber-body [contenteditable="true"]').count()).toBe(1);
		} finally {
			await page.close();
		}
	}, 60_000);

	test('client-side nav from the dashboard into the editor does not 500 (layout-reuse regression)', async () => {
		// Regression guard for the per-space 500s. On a *same-slug* client-side
		// navigation SvelteKit reuses the `[slug]` layout's cached `load` and does
		// not re-run it, so a child load that read `locals.space` (the layout's
		// side effect) saw null and threw. A hard `page.goto` masks the bug (the
		// layout runs on SSR) — the regression only shows on an in-app link click,
		// which is why the goto-based editor test above passed even when this
		// path was broken. Exercises the dashboard (index load) → editor (edit
		// load) hop, the two loads that were on the broken side-channel.
		const page = await signedInContext.newPage();
		try {
			// Hard-load the dashboard so the [slug] layout runs once and the client
			// router hydrates; then click an in-app link (client-side nav).
			await page.goto(base + '/admin/spaces/' + spaceSlug, { waitUntil: 'networkidle' });
			await page.waitForSelector('.amber-page-list a[href$="/edit/about"]', { timeout: 20_000 });
			// Sentinel survives a client-side nav but is wiped by a full reload —
			// proves the click really went through the SPA router (where the layout
			// is reused), so this test actually guards the reported failure mode.
			await page.evaluate(() => ((window as unknown as { __spa: boolean }).__spa = true));
			await page.click('.amber-page-list a[href$="/edit/about"]');
			await page.waitForURL(base + '/admin/spaces/' + spaceSlug + '/edit/about', {
				timeout: 15_000
			});
			await page.waitForSelector('.amber-body [contenteditable="true"]', { timeout: 20_000 });
			expect(await page.locator('.amber-body [contenteditable="true"]').count()).toBe(1);
			expect(await page.evaluate(() => (window as unknown as { __spa?: boolean }).__spa)).toBe(
				true
			);
		} finally {
			await page.close();
		}
	}, 60_000);

	test('the PUT endpoint saves a body-only change (with session cookie)', async () => {
		const cookies = await signedInContext.cookies();
		const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
		const res = await fetch(base + '/admin/spaces/' + spaceSlug + '/api/page/about', {
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

	test('theme picker writes space.toml and the public site hot-reloads (no restart)', async () => {
		const page = await signedInContext.newPage();
		try {
			// Switch to amber-editorial via the picker.
			await page.goto(base + '/admin/spaces/' + spaceSlug + '/theme', { waitUntil: 'networkidle' });
			await page.check('input[name="theme"][value="amber-editorial"]');
			await page.click('div.actions button[type="submit"]');
			await page.waitForURL(base + '/admin/spaces/' + spaceSlug + '/theme', { timeout: 15_000 });

			// space.toml on disk carries the theme line.
			expect(readFileSync(join(workDir, 'space.toml'), 'utf8')).toContain(
				'theme = "amber-editorial"'
			);

			// Public homepage now links amber-editorial's stylesheet (watcher hot-reload).
			expect(
				await waitForBodyContaining(base + '/', '/themes/amber-editorial/theme.css')
			).toContain('/themes/amber-editorial/theme.css');

			// Revert to install default.
			await page.goto(base + '/admin/spaces/' + spaceSlug + '/theme', { waitUntil: 'networkidle' });
			await page.check('input[name="theme"][value=""]');
			await page.click('div.actions button[type="submit"]');
			await page.waitForURL(base + '/admin/spaces/' + spaceSlug + '/theme', { timeout: 15_000 });

			// No routing fields in single-space mode → the file is removed entirely.
			expect(existsSync(join(workDir, 'space.toml'))).toBe(false);

			// Public homepage reverts to amber-default's stylesheet.
			expect(await waitForBodyContaining(base + '/', '/themes/amber-default/theme.css')).toContain(
				'/themes/amber-default/theme.css'
			);
		} finally {
			await page.close();
		}
	}, 90_000);

	test('subsystem-2 URLs redirect to per-space URLs (back-compat shims)', async () => {
		const cookies = await signedInContext.cookies();
		const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

		// /admin/edit/[...path] → 302 → /admin/spaces/example-space/edit/[...path]
		const editShim = await fetch(base + '/admin/edit/about', {
			method: 'GET',
			headers: { cookie: cookieHeader },
			redirect: 'manual'
		});
		expect(editShim.status).toBe(302);
		expect(editShim.headers.get('location')).toBe('/admin/spaces/' + spaceSlug + '/edit/about');

		// /admin/new → 302 → /admin/spaces/example-space/new
		const newShim = await fetch(base + '/admin/new', {
			method: 'GET',
			headers: { cookie: cookieHeader },
			redirect: 'manual'
		});
		expect(newShim.status).toBe(302);
		expect(newShim.headers.get('location')).toBe('/admin/spaces/' + spaceSlug + '/new');

		// /admin/api/page/[...path] → 308 (preserves PUT) → /admin/spaces/example-space/api/page/[...]
		const saveShim = await fetch(base + '/admin/api/page/about', {
			method: 'PUT',
			headers: {
				'Content-Type': 'application/json',
				'If-Match': '*',
				cookie: cookieHeader
			},
			body: JSON.stringify({ body: 'Shim-routed body.\n' }),
			redirect: 'manual'
		});
		expect(saveShim.status).toBe(308);
		expect(saveShim.headers.get('location')).toBe('/admin/spaces/' + spaceSlug + '/api/page/about');
	}, 60_000);

	test('login page Google button carries callbackURL — defaults to /admin and threads validated ?next=', async () => {
		const context = await browser.newContext();
		const page = await context.newPage();
		try {
			await page.goto(base + '/admin/login', { waitUntil: 'networkidle' });
			const plain = await page.locator('a.amber-oauth-button').getAttribute('href');
			expect(plain).toBe(
				`/api/auth/sign-in/social/google?callbackURL=${encodeURIComponent('/admin')}`
			);

			await page.goto(base + '/admin/login?next=' + encodeURIComponent('/admin/edit/about'), {
				waitUntil: 'networkidle'
			});
			const withNext = await page.locator('a.amber-oauth-button').getAttribute('href');
			expect(withNext).toBe(
				`/api/auth/sign-in/social/google?callbackURL=${encodeURIComponent('/admin/edit/about')}`
			);

			// Open-redirect attempt must be sanitised to /admin before reaching the OAuth callback.
			await page.goto(base + '/admin/login?next=' + encodeURIComponent('//evil.example.com/'), {
				waitUntil: 'networkidle'
			});
			const sanitised = await page.locator('a.amber-oauth-button').getAttribute('href');
			expect(sanitised).toBe(
				`/api/auth/sign-in/social/google?callbackURL=${encodeURIComponent('/admin')}`
			);
		} finally {
			await context.close();
		}
	}, 60_000);

	test('sign-out then login round-trip preserves ?next=', async () => {
		const context = await browser.newContext({
			storageState: await signedInContext.storageState()
		});
		const page = await context.newPage();
		try {
			// Sign out via the chrome button (POSTs to /api/auth/sign-out).
			// /admin single-space-shortcuts to /admin/spaces/<slug> — that's
			// where the chrome's sign-out button lives.
			await page.goto(base + '/admin/spaces/' + spaceSlug, { waitUntil: 'networkidle' });
			await page.click('button.amber-signout-button');
			await page.waitForLoadState('networkidle');

			// Now navigate to a guarded per-space route — should bounce to /admin/login.
			const guarded = '/admin/spaces/' + spaceSlug + '/edit/about';
			const response = await page.goto(base + guarded, { waitUntil: 'networkidle' });
			expect(response?.status()).toBeLessThan(400);
			expect(page.url()).toContain('/admin/login');
			expect(page.url()).toContain(encodeURIComponent(guarded));

			// Sign back in.
			await page.fill('input[name="email"]', ADMIN_EMAIL);
			await page.fill('input[name="password"]', ADMIN_PASSWORD);
			await page.click('button[type="submit"]');
			await page.waitForURL(base + guarded, { timeout: 15_000 });
		} finally {
			await context.close();
		}
	}, 60_000);
});
