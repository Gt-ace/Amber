/**
 * Browser-level admin smoke. Opt-in: only runs when `AMBER_E2E` is set (see
 * apps/web/CLAUDE.md → "End-to-end smoke"). Builds the production bundle,
 * boots it under Bun with AMBER_DEV_UNSAFE=1 against a throwaway copy of the
 * example-space fixture, then in a real Chromium:
 *   - loads `/admin` and asserts the page list rendered;
 *   - opens `/admin/edit/about` and asserts the Crepe editor mounted;
 *   - PUTs a body-only save and asserts 200 + a returned hash.
 *
 * The bundle is rebuilt so the smoke reflects HEAD. The fixture is copied to a
 * temp dir because the editor writes to disk.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

beforeAll(async () => {
	execFileSync('bun', ['run', 'build'], { cwd: APP_ROOT, stdio: 'inherit' });

	workDir = mkdtempSync(join(tmpdir(), 'amber-admin-e2e-'));
	cpSync(FIXTURE, workDir, { recursive: true });

	const port = await freePort();
	base = `http://127.0.0.1:${port}`;
	server = spawn('bun', [BUNDLE], {
		cwd: APP_ROOT,
		env: {
			...process.env,
			AMBER_SPACE_PATH: workDir,
			AMBER_DEV_UNSAFE: '1',
			PORT: String(port),
			HOST: '127.0.0.1'
		},
		stdio: 'ignore'
	});
	await waitForServer(base + '/admin');
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
	test('the admin index lists pages', async () => {
		const page = await browser.newPage();
		try {
			await page.goto(base + '/admin', { waitUntil: 'networkidle' });
			expect(await page.locator('a[href="/admin/edit/about"]').count()).toBeGreaterThan(0);
		} finally {
			await page.close();
		}
	}, 60_000);

	test('the editor mounts Crepe for a page', async () => {
		const page = await browser.newPage();
		try {
			await page.goto(base + '/admin/edit/about', { waitUntil: 'networkidle' });
			// Crepe mounts a ProseMirror contenteditable inside the body container.
			await page.waitForSelector('.amber-body [contenteditable="true"]', { timeout: 20_000 });
			expect(await page.locator('.amber-body [contenteditable="true"]').count()).toBe(1);
		} finally {
			await page.close();
		}
	}, 60_000);

	test('the PUT endpoint saves a body-only change', async () => {
		// Read the load-time hash by asking the endpoint to reject a bad one,
		// then overwrite unconditionally — the smoke checks the wire, not concurrency.
		const res = await fetch(base + '/admin/api/page/about', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', 'If-Match': '*' },
			body: JSON.stringify({ body: 'Smoke-tested body.\n' })
		});
		expect(res.status).toBe(200);
		const out = (await res.json()) as { hash: string };
		expect(out.hash).toMatch(/^[0-9a-f]{64}$/);
	}, 60_000);
});
