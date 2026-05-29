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
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
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
		// Resolver builds the redirect target as `${adminScheme}//${adminHost}${path}${search}`,
		// preserving the scheme of AMBER_PUBLIC_URL (http in this test, https in prod).
		expect(loc).toBe(`http://${ADMIN_HOST}/admin/spaces?probe=1`);
	}, 30_000);

	test('/admin on the admin host without a session → /admin/setup or /admin/login', async () => {
		const r = await fetch(base + '/admin', {
			headers: forwardedHeaders(ADMIN_HOST),
			redirect: 'manual'
		});
		expect([302, 303]).toContain(r.status);
		expect(r.headers.get('location') ?? '').toMatch(/\/admin\/(setup|login)/);
	}, 30_000);

	test('prefix-mode: GET /scratch/notes serves the prefix-owning space (not default)', async () => {
		// Unclaimed host so the host-byHost branch misses; the prefix must
		// win over the default fallback for paths under /scratch.
		const r = await fetch(base + '/scratch/notes', {
			headers: forwardedHeaders(RANDOM_HOST)
		});
		expect(r.status).toBe(200);
		const body = await r.text();
		expect(body).toContain('Scratch notes page.');
		expect(body).not.toContain('Default home');
	}, 30_000);

	test('prefix-mode: GET /scratch (exact) serves the prefix-owning index', async () => {
		const r = await fetch(base + '/scratch', {
			headers: forwardedHeaders(RANDOM_HOST)
		});
		expect(r.status).toBe(200);
		const body = await r.text();
		expect(body).toContain('This is the scratch space.');
		expect(body).not.toContain('Default home');
	}, 30_000);

	test('install-admin creates a new space via /admin/new-space and the new prefix serves immediately', async () => {
		// Helper to thread a cookie jar through fetch calls.
		const cookies = new Map<string, string>();
		function cookieHeader(): string {
			return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
		}
		function ingestSetCookie(res: Response): void {
			// Bun's fetch exposes setCookie() (plural) for multi-Set-Cookie headers.
			// Fall back to a single get('set-cookie') for environments without it.
			const all = (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie?.()
				?? (res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []);
			for (const raw of all) {
				const first = raw.split(';')[0];
				const eq = first.indexOf('=');
				if (eq > 0) cookies.set(first.slice(0, eq).trim(), first.slice(eq + 1).trim());
			}
		}
		async function fetchWith(url: string, init: RequestInit = {}): Promise<Response> {
			const headers = new Headers(init.headers);
			// Always run against the admin host for admin/auth endpoints; the
			// caller overrides this header when probing public URLs on other hosts.
			if (!headers.has('X-Forwarded-Host')) {
				headers.set('X-Forwarded-Host', ADMIN_HOST);
				headers.set('X-Forwarded-Proto', 'http');
			}
			if (cookies.size > 0) headers.set('cookie', cookieHeader());
			const res = await fetch(url, { ...init, headers, redirect: 'manual' });
			ingestSetCookie(res);
			return res;
		}

		// (a) Claim install-admin via /admin/setup. Fetch the page first so
		// the cookie jar is primed with any cookies the GET issues.
		const setupGet = await fetchWith(`${base}/admin/setup`);
		expect(setupGet.status).toBe(200);

		// Submit setup. /admin/setup is a SvelteKit form action — POST to the
		// same URL with form-encoded body.
		const setupRes = await fetchWith(`${base}/admin/setup`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'X-Sveltekit-Action': 'true'
			},
			body: new URLSearchParams({
				email: 'admin@x.test',
				password: 'password123'
			}).toString()
		});
		// SvelteKit's form action returns 200 with JSON {type:"redirect",...} on
		// success (when X-Sveltekit-Action is set), or a 3xx if not. Both mean
		// the user row was created.
		expect([200, 204, 302, 303]).toContain(setupRes.status);

		// (b) Submit the create form. The action redirects to
		// /admin/spaces/<slug> on success.
		const createRes = await fetchWith(`${base}/admin/new-space`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				'X-Sveltekit-Action': 'true'
			},
			body: new URLSearchParams({
				title: 'Hot Notes',
				slug: 'hot-notes',
				routingKind: 'prefix',
				prefix: '/hot-notes',
				host: ''
			}).toString()
		});
		// SvelteKit form actions return JSON with the redirect info under type:
		// "redirect" + location; the raw HTTP status is 200 (or 204) for the
		// action invocation itself. Verify the action succeeded, then read the
		// response body for the redirect target.
		expect([200, 204, 302, 303]).toContain(createRes.status);
		if (createRes.status === 200 || createRes.status === 204) {
			const text = await createRes.text();
			// The action's redirect-to path appears verbatim in the response.
			expect(text).toContain('/admin/spaces/hot-notes');
		} else {
			expect(createRes.headers.get('location') ?? '').toMatch(/\/admin\/spaces\/hot-notes/);
		}

		// (c) Verify the directory exists on disk and the new prefix serves.
		const newDir = join(workDir, 'hot-notes');
		expect(existsSync(join(newDir, 'amber.toml'))).toBe(true);
		expect(existsSync(join(newDir, 'space.toml'))).toBe(true);
		expect(existsSync(join(newDir, 'index.md'))).toBe(true);

		// (d) The new prefix /hot-notes on the default host (any unclaimed
		// host falls through to site-default which is `default = true`) MUST
		// serve the scaffolded index.md — no restart. The prefix wins over
		// the default fallback because the resolver prefers prefix match for
		// pathnames under /hot-notes.
		const publicRes = await fetch(`${base}/hot-notes`, {
			headers: forwardedHeaders(RANDOM_HOST)
		});
		expect(publicRes.status).toBe(200);
		const body = await publicRes.text();
		expect(body).toContain('Hot Notes');
	}, 90_000);
});
