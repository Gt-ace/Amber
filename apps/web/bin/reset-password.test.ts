/**
 * Reset-password CLI smoke (spec §7, §11).
 *
 * Boots a throwaway auth.db via the setup action so the schema and an admin
 * row exist, then spawns the CLI as a subprocess. Asserts:
 *
 *   - exit 0, a temporary password printed to stdout.
 *   - the credential account's hash now verifies against the printed temp
 *     password (proves the format matches better-auth's runtime).
 *   - existing sessions are revoked.
 *   - unknown email exits non-zero.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Database } from 'bun:sqlite';
import { verifyPassword } from 'better-auth/crypto';

const FIXTURE = fileURLToPath(new URL('../fixtures/example-space/', import.meta.url));
const CLI = fileURLToPath(new URL('./reset-password.ts', import.meta.url));

let workDir: string;
let resetSingleton: () => void;
let setupActions: typeof import('../src/routes/admin/(public)/setup/+page.server.ts').actions;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-reset-'));
	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });
	setupActions = (await import('../src/routes/admin/(public)/setup/+page.server.ts')).actions;
	const cfg = await import('../src/lib/server/auth-config');
	resetSingleton = cfg._resetAuthSingleton;
});

afterEach(async () => {
	const { getSpace } = await import('$lib/server/space');
	try {
		getSpace().close();
	} catch {
		/* */
	}
	resetSingleton();
	rmSync(workDir, { recursive: true, force: true });
});

async function claimAdmin() {
	const fd = new FormData();
	fd.set('email', 'admin@x.test');
	fd.set('password', 'password123');
	fd.set('name', 'Admin');
	const ev = {
		request: { formData: async () => fd, headers: new Headers() }
	} as unknown as Parameters<NonNullable<typeof setupActions.default>>[0];
	await setupActions.default!(ev).catch((e) => {
		if ((e as { status?: number }).status !== 302) throw e;
	});
	// Make sure the singleton releases auth.db so the CLI can open it.
	resetSingleton();
}

function runCli(args: string[]) {
	return spawnSync('bun', [CLI, ...args], {
		env: { ...process.env, AMBER_SPACE_PATH: workDir },
		cwd: resolve(workDir),
		encoding: 'utf8'
	});
}

describe('reset-password CLI', () => {
	test('writes a new hash and revokes sessions', async () => {
		await claimAdmin();
		// Open the db read-only to inspect; we'll close and reopen later.
		{
			const db = new Database(join(workDir, '.amber/auth.db'));
			const sessions = db.query('SELECT COUNT(*) AS n FROM session').get() as { n: number };
			expect(sessions.n).toBeGreaterThanOrEqual(1);
			db.close();
		}

		const result = runCli(['--email', 'admin@x.test']);
		expect(result.status).toBe(0);
		const match = result.stdout.match(/Temporary password: (\S+)/);
		expect(match).toBeTruthy();
		const tempPassword = match![1];

		const db = new Database(join(workDir, '.amber/auth.db'));
		try {
			const account = db
				.query("SELECT password FROM account WHERE providerId = 'credential'")
				.get() as { password: string } | undefined;
			expect(account?.password).toBeTruthy();
			const ok = await verifyPassword({ hash: account!.password, password: tempPassword });
			expect(ok).toBe(true);

			const sessions = db.query('SELECT COUNT(*) AS n FROM session').get() as { n: number };
			expect(sessions.n).toBe(0);
		} finally {
			db.close();
		}
	});

	test('exits non-zero on unknown email', async () => {
		await claimAdmin();
		const result = runCli(['--email', 'unknown@x.test']);
		expect(result.status).not.toBe(0);
		expect(result.stderr).toMatch(/no user/i);
	});
});
