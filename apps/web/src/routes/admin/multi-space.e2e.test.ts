/**
 * Multi-space e2e smoke (spec §9). Opt-in via AMBER_E2E. Boots the production
 * bundle with AMBER_SPACES_DIR pointing at a throwaway copy of the
 * multi-space-fixture and exercises:
 *
 *   - Host routing: X-Forwarded-Host: site-a.localtest.me serves site-a/index.md.
 *   - Default fallback: an unclaimed host falls through to the `default = true`
 *     space.
 *   - Admin host short-circuit: /admin on a per-space host → 302 to the admin
 *     host (preserves path + query).
 *   - Picker shape: /admin on the admin host without a session → 302/303 to
 *     /admin/setup or /admin/login (signed-in picker behaviour is covered by
 *     admin.e2e.test.ts; this smoke just confirms the guard fires).
 *
 * Why X-Forwarded-* and not Host:
 * adapter-node resolves `event.url` from `ORIGIN || get_origin(req.headers)`.
 * Setting ORIGIN pins `event.url.host` to one value (no host routing). Leaving
 * it unset works for `Host:` but defaults protocol to https, which trips
 * better-auth's origin check against an http:// AMBER_PUBLIC_URL. The
 * production answer (and what Caddy uses) is `HOST_HEADER=x-forwarded-host` +
 * `PROTOCOL_HEADER=x-forwarded-proto`; we mirror that here so the test
 * exercises the same code path as deployment. AMBER_PUBLIC_URL has no port so
 * the derived adminHost (`URL.host` of `http://admin.localtest.me`) is the
 * bare string the resolver's byHost index also uses.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const APP_ROOT = fileURLToPath(new URL('../../../', import.meta.url)); // apps/web/
const BUNDLE = resolve(APP_ROOT, 'build/index.js');
const FIXTURE = resolve(APP_ROOT, 'fixtures/multi-space-fixture');

const ADMIN_HOST = 'admin.localtest.me';
const SITE_A_HOST = 'site-a.localtest.me';
const RANDOM_HOST = 'random.localtest.me';

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
			const r = await fetch(url, { headers: forwardedHeaders(ADMIN_HOST) });
			if (r.status > 0) return;
		} catch {
			// not up yet
		}
		if (Date.now() > deadline) throw new Error(`server at ${url} did not come up`);
		await new Promise((r) => setTimeout(r, 200));
	}
}

function forwardedHeaders(host: string): Record<string, string> {
	return {
		'X-Forwarded-Host': host,
		'X-Forwarded-Proto': 'http'
	};
}

let server: ChildProcess;
let base: string;
let workDir: string;

beforeAll(async () => {
	execFileSync('bun', ['--bun', 'run', 'build'], { cwd: APP_ROOT, stdio: 'inherit' });

	workDir = mkdtempSync(join(tmpdir(), 'amber-multi-e2e-'));
	cpSync(FIXTURE, workDir, { recursive: true });

	const port = await freePort();
	base = `http://127.0.0.1:${port}`;
	// Explicitly strip AMBER_SPACE_PATH so the boot's mutual-exclusion check
	// (and auth-db's path resolution) both fall through to AMBER_SPACES_DIR.
	// `AMBER_SPACE_PATH: ''` would have left an empty string in the child env
	// — empty-but-set, which trips `??` chains downstream.
	const { AMBER_SPACE_PATH: _strip, ...parentEnv } = process.env;
	server = spawn('bun', [BUNDLE], {
		cwd: APP_ROOT,
		env: {
			...parentEnv,
			PORT: String(port),
			HOST: '127.0.0.1',
			// Important: do NOT set ORIGIN. Setting it pins event.url.host and
			// disables the host-routing we're testing. Instead we mirror the
			// production reverse-proxy setup and let adapter-node read host +
			// protocol from forwarded headers.
			HOST_HEADER: 'x-forwarded-host',
			PROTOCOL_HEADER: 'x-forwarded-proto',
			AMBER_SPACES_DIR: workDir,
			AMBER_AUTH_SECRET: 'multi-e2e-secret-' + 'x'.repeat(32),
			// Bare host (no port) so the derived adminHost matches what
			// resolver.byHost / space.toml `host` strings can hold (the
			// space-routing parser's BARE_HOST_RE rejects ports).
			AMBER_PUBLIC_URL: `http://${ADMIN_HOST}`
		},
		stdio: 'inherit'
	});
	await waitForServer(base + '/');
}, 120_000);

afterAll(async () => {
	server?.kill('SIGTERM');
	await new Promise((r) => setTimeout(r, 300));
	if (server && !server.killed) server.kill('SIGKILL');
	if (workDir) rmSync(workDir, { recursive: true, force: true });
}, 10_000);

describe('multi-space routing smoke (AMBER_E2E)', () => {
	test('host routing: site-a.localtest.me serves site-a/index.md', async () => {
		const r = await fetch(base + '/', { headers: forwardedHeaders(SITE_A_HOST) });
		expect(r.status).toBe(200);
		const body = await r.text();
		expect(body).toContain('Site A home');
		expect(body).not.toContain('Default home');
	}, 30_000);

	test('default fallback: an unclaimed host falls through to the default space', async () => {
		const r = await fetch(base + '/', { headers: forwardedHeaders(RANDOM_HOST) });
		expect(r.status).toBe(200);
		const body = await r.text();
		expect(body).toContain('Default home');
		expect(body).not.toContain('Site A home');
	}, 30_000);

	test('/admin on a per-space host → 302 to the admin host (preserves path + query)', async () => {
		const r = await fetch(base + '/admin/spaces?probe=1', {
			headers: forwardedHeaders(SITE_A_HOST),
			redirect: 'manual'
		});
		expect(r.status).toBe(302);
		const loc = r.headers.get('location') ?? '';
		// Resolver builds the redirect target as `https://${adminHost}${path}${search}`.
		expect(loc).toBe(`https://${ADMIN_HOST}/admin/spaces?probe=1`);
	}, 30_000);

	test('/admin on the admin host without a session → /admin/setup or /admin/login', async () => {
		const r = await fetch(base + '/admin', {
			headers: forwardedHeaders(ADMIN_HOST),
			redirect: 'manual'
		});
		expect([302, 303]).toContain(r.status);
		expect(r.headers.get('location') ?? '').toMatch(/\/admin\/(setup|login)/);
	}, 30_000);
});
