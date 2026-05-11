/**
 * Browser-level hydration smoke. Opt-in: only runs when `AMBER_E2E` is set
 * (see apps/web/CLAUDE.md → "End-to-end smoke"). Builds the production bundle,
 * boots it under Bun against the example-space fixture, then in a real
 * Chromium:
 *   - loads `/` and asserts the page's <article> is inside <main> — the layout
 *     owns that landmark, and a regression there is exactly the bug fixed in
 *     dd881ff (which the route-handler unit tests missed because they only
 *     import the handler, never hydrate);
 *   - clicks an internal nav link and re-checks the same invariant;
 *   - asserts no `hydration_*` console messages fired (SSR and CSR markup
 *     agree).
 *
 * apps/web/CLAUDE.md: "Direct unit tests of handler functions are necessary
 * but not sufficient." This is the not-sufficient half.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { chromium, type Browser } from 'playwright';

const APP_ROOT = fileURLToPath(new URL('../../../', import.meta.url)); // apps/web/
const BUNDLE = resolve(APP_ROOT, 'build/index.js');
const FIXTURE = resolve(APP_ROOT, 'fixtures/example-space');

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
			if (r.ok) return;
		} catch {
			// not up yet
		}
		if (Date.now() > deadline)
			throw new Error(`server at ${url} did not come up in ${timeoutMs}ms`);
		await new Promise((r) => setTimeout(r, 200));
	}
}

let server: ChildProcess;
let browser: Browser;
let base: string;

beforeAll(async () => {
	// Build from current source so the smoke reflects HEAD, not a stale bundle.
	execFileSync('bun', ['run', 'build'], { cwd: APP_ROOT, stdio: 'inherit' });

	const port = await freePort();
	base = `http://127.0.0.1:${port}`;
	server = spawn('bun', [BUNDLE], {
		cwd: APP_ROOT,
		env: { ...process.env, AMBER_SPACE_PATH: FIXTURE, PORT: String(port), HOST: '127.0.0.1' },
		stdio: 'ignore'
	});
	await waitForServer(base + '/');
	browser = await chromium.launch();
}, 120_000);

afterAll(async () => {
	await browser?.close();
	server?.kill('SIGTERM');
	await new Promise((r) => setTimeout(r, 300));
	if (server && !server.killed) server.kill('SIGKILL');
});

describe('hydration smoke (AMBER_E2E)', () => {
	test('home page and a nav-link navigation hydrate cleanly under <main>', async () => {
		const page = await browser.newPage();
		try {
			const consoleMsgs: string[] = [];
			page.on('console', (m) => consoleMsgs.push(m.text()));
			page.on('pageerror', (e) => consoleMsgs.push('pageerror: ' + e.message));

			await page.goto(base + '/', { waitUntil: 'networkidle' });
			expect(await page.evaluate(() => !!document.querySelector('article')?.closest('main'))).toBe(
				true
			);

			// First internal nav link that isn't the homepage itself.
			const href = await page.evaluate(() => {
				const a = [...document.querySelectorAll<HTMLAnchorElement>('a[href^="/"]')].find(
					(el) => el.getAttribute('href') !== '/'
				);
				return a?.getAttribute('href') ?? null;
			});
			expect(href).toBeTruthy();

			await page.locator(`a[href="${href}"]`).first().click();
			await page.waitForURL(base + href!);
			await page.waitForLoadState('networkidle');
			expect(await page.evaluate(() => !!document.querySelector('article')?.closest('main'))).toBe(
				true
			);

			const hydrationMsgs = consoleMsgs.filter((m) => /hydrat/i.test(m));
			expect(hydrationMsgs).toEqual([]);
		} finally {
			await page.close();
		}
	}, 60_000);
});
