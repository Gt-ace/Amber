/**
 * Multi-user e2e smoke (spec §13 / sub-4 follow-up). Opt-in via AMBER_E2E.
 * Boots the production bundle in multi-space mode against the
 * multi-space-fixture and exercises the full invite round-trip:
 *
 *   1. Claim install-admin at /admin/setup.
 *   2. Generate an editor invite at /admin/spaces/site-a/members and read
 *      the one-shot invite URL.
 *   3. Open the invite URL in a fresh browser context, create a new account,
 *      land on /admin/spaces/site-a.
 *   4. As install-admin, /admin/users shows the new editor.
 *   5. As install-admin, remove the editor. The editor's *still-valid*
 *      session — same Playwright context, no re-auth — gets 404 on the
 *      next edit-route request: the gate is missing membership, not an
 *      absent cookie.
 *   6. Run bin/grant-ownership.ts to upgrade the same editor to owner of
 *      site-a; the editor (same context) can now load
 *      /admin/spaces/site-a/members (owner-only).
 *
 * Single ORIGIN-pinned host. Public host routing isn't exercised here — the
 * multi-user flow is admin-surface only. The space's `host =` in space.toml
 * stays on disk and is asserted by the existing multi-space.e2e.test.ts.
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
const FIXTURE = resolve(APP_ROOT, 'fixtures/multi-space-fixture');
const TARGET_SLUG = 'site-a';

const ADMIN_EMAIL = 'admin@x.test';
const ADMIN_PASSWORD = 'admin-password-123';
const EDITOR_EMAIL = 'editor@x.test';
const EDITOR_PASSWORD = 'editor-password-123';

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
let base: string;
let workDir: string;
let adminContext: BrowserContext;
let editorContext: BrowserContext;
let inviteUrl: string;

beforeAll(async () => {
	execFileSync('bun', ['--bun', 'run', 'build'], { cwd: APP_ROOT, stdio: 'inherit' });

	workDir = mkdtempSync(join(tmpdir(), 'amber-members-e2e-'));
	cpSync(FIXTURE, workDir, { recursive: true });

	const port = await freePort();
	base = `http://127.0.0.1:${port}`;

	// AMBER_SPACE_PATH must not be set; multi-space mode requires
	// AMBER_SPACES_DIR exclusively.
	const { AMBER_SPACE_PATH: _strip, ...parentEnv } = process.env;
	server = spawn('bun', [BUNDLE], {
		cwd: APP_ROOT,
		env: {
			...parentEnv,
			AMBER_SPACES_DIR: workDir,
			AMBER_AUTH_SECRET: 'members-e2e-secret-' + 'x'.repeat(32),
			AMBER_PUBLIC_URL: base,
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
	await adminContext?.close();
	await editorContext?.close();
	await browser?.close();
	server?.kill('SIGTERM');
	await new Promise((r) => setTimeout(r, 300));
	if (server && !server.killed) server.kill('SIGKILL');
	if (workDir) rmSync(workDir, { recursive: true, force: true });
}, 10_000);

describe('multi-user invite round-trip (AMBER_E2E)', () => {
	test('1. claim install-admin via /admin/setup', async () => {
		const context = await browser.newContext();
		const page = await context.newPage();
		try {
			await page.goto(base + '/admin/setup', { waitUntil: 'networkidle' });
			await page.fill('input[name="email"]', ADMIN_EMAIL);
			await page.fill('input[name="password"]', ADMIN_PASSWORD);
			await page.click('button[type="submit"]');
			// Setup posts then redirects to /admin. In multi-space mode with
			// three loaded spaces the install-admin doesn't single-space-shortcut;
			// they land on the picker.
			await page.waitForURL(base + '/admin', { timeout: 15_000 });
			expect(page.url()).toBe(base + '/admin');
			adminContext = context;
		} catch (e) {
			await context.close();
			throw e;
		}
	}, 60_000);

	test('2. install-admin generates an editor invite on /admin/spaces/site-a/members', async () => {
		const page = await adminContext.newPage();
		try {
			await page.goto(base + `/admin/spaces/${TARGET_SLUG}/members`, {
				waitUntil: 'networkidle'
			});
			// Default role on the form is editor (first <option>); leave it.
			await page.click('form[action="?/generateInvite"] button[type="submit"]');
			// The form uses use:enhance — wait for the one-shot URL panel.
			await page.waitForSelector('input[aria-label="Invite URL"]', { timeout: 10_000 });
			const url = await page.locator('input[aria-label="Invite URL"]').inputValue();
			expect(url).toContain('/admin/invite/');
			inviteUrl = url;
		} finally {
			await page.close();
		}
	}, 60_000);

	test('3. fresh browser redeems the invite as a new user', async () => {
		expect(inviteUrl).toBeTruthy();
		const context = await browser.newContext();
		const page = await context.newPage();
		try {
			await page.goto(inviteUrl, { waitUntil: 'networkidle' });
			await page.fill('input[name="email"]', EDITOR_EMAIL);
			await page.fill('input[name="password"]', EDITOR_PASSWORD);
			await page.fill('input[name="name"]', 'Editor One');
			await page.click('form[action="?/redeemAsNew"] button[type="submit"]');
			// Redemption redirects to /admin/spaces/site-a. The editor's lone
			// membership also makes the picker single-space-shortcut land them
			// there directly on any future /admin navigation.
			await page.waitForURL(base + `/admin/spaces/${TARGET_SLUG}`, { timeout: 15_000 });
			editorContext = context;
		} catch (e) {
			await context.close();
			throw e;
		}
	}, 60_000);

	test('4. install-admin sees the new editor in /admin/users', async () => {
		const page = await adminContext.newPage();
		try {
			await page.goto(base + '/admin/users', { waitUntil: 'networkidle' });
			const tableText = await page.locator('table').textContent();
			expect(tableText).toContain(EDITOR_EMAIL);
		} finally {
			await page.close();
		}
	}, 60_000);

	test('5. removing the editor → their next edit request 404s (session still valid)', async () => {
		// Admin removes the editor from site-a/members.
		const adminPage = await adminContext.newPage();
		try {
			await adminPage.goto(base + `/admin/spaces/${TARGET_SLUG}/members`, {
				waitUntil: 'networkidle'
			});
			// Editor's row is the only non-admin row. Click its Remove button.
			// The members table renders rows with an action=?/removeMember form
			// per row; we target the form whose surrounding row contains the
			// editor's email.
			const editorRow = adminPage.locator('tr', { hasText: EDITOR_EMAIL });
			await editorRow.locator('form[action="?/removeMember"] button[type="submit"]').click();
			// use:enhance invalidates the load on success, but the re-render is
			// async — reload to force a fresh fetch before asserting the row
			// is actually gone server-side.
			await adminPage.reload({ waitUntil: 'networkidle' });
			expect(await adminPage.locator('tr', { hasText: EDITOR_EMAIL }).count()).toBe(0);
		} finally {
			await adminPage.close();
		}

		// Editor's session is still valid (cookies untouched), but their
		// member row is gone. requireSpaceAccess() in the [slug] layout 404s.
		const editorPage = await editorContext.newPage();
		try {
			const response = await editorPage.goto(
				base + `/admin/spaces/${TARGET_SLUG}/edit/about`,
				{ waitUntil: 'networkidle' }
			);
			expect(response?.status()).toBe(404);
		} finally {
			await editorPage.close();
		}
	}, 60_000);

	test('6. grant-ownership CLI upgrades the editor to owner; members page now loads', async () => {
		// Run the offline grant-ownership escape hatch. The CLI reads
		// AMBER_SPACES_DIR to resolve auth.db, so we thread the same env we
		// gave the server.
		execFileSync(
			'bun',
			['run', 'bin/grant-ownership.ts', '--email', EDITOR_EMAIL, '--space', TARGET_SLUG],
			{
				cwd: APP_ROOT,
				env: {
					...process.env,
					AMBER_SPACES_DIR: workDir,
					AMBER_AUTH_SECRET: 'members-e2e-secret-' + 'x'.repeat(32),
					AMBER_PUBLIC_URL: base
				},
				stdio: 'inherit'
			}
		);

		// Same editor context (session cookie still valid). The members page
		// is owner-only; an editor would be 403'd by requireSpaceAccess. A
		// 200 with the page heading proves the upgrade landed.
		const page = await editorContext.newPage();
		try {
			const response = await page.goto(
				base + `/admin/spaces/${TARGET_SLUG}/members`,
				{ waitUntil: 'networkidle' }
			);
			expect(response?.status()).toBe(200);
			const h1Text = await page.locator('h1').textContent();
			expect(h1Text).toContain('Members of');
		} finally {
			await page.close();
		}
	}, 60_000);
});
