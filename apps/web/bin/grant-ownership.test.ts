import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations } from '../src/lib/server/auth-migrations';

const CLI = fileURLToPath(new URL('./grant-ownership.ts', import.meta.url));

let workDir: string;
let dbPath: string;
let db: Database;

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-grant-'));
	mkdirSync(join(workDir, '.amber'), { recursive: true });
	dbPath = join(workDir, '.amber', 'auth.db');
	process.env.AMBER_SPACE_PATH = workDir;
	db = new Database(dbPath);
	// Minimal user table stand-in; the CLI doesn't need the full better-auth schema.
	// isInstallAdmin is added by migration 0001, so omit it here.
	db.exec(
		`CREATE TABLE user (
			id TEXT PRIMARY KEY,
			email TEXT UNIQUE NOT NULL,
			name TEXT
		);`
	);
	applyAmberAuthMigrations(db);
	db.close();
});

afterEach(() => {
	rmSync(workDir, { recursive: true, force: true });
});

async function runCli(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
	const proc = Bun.spawn(['bun', 'run', CLI, ...args], {
		env: { ...process.env, AMBER_SPACE_PATH: workDir },
		stdout: 'pipe',
		stderr: 'pipe'
	});
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	const code = await proc.exited;
	return { code, stdout, stderr };
}

describe('grant-ownership CLI', () => {
	test('inserts an owner row for a valid user', async () => {
		const d = new Database(dbPath);
		d.run("INSERT INTO user (id, email, name, isInstallAdmin) VALUES ('u-1', 'a@x.test', 'A', 0)");
		d.close();
		const r = await runCli(['--email', 'a@x.test', '--space', 'site-a']);
		expect(r.code).toBe(0);
		const dd = new Database(dbPath);
		const row = dd.query('SELECT role FROM member WHERE user_id = ?1').get('u-1');
		expect((row as { role: string }).role).toBe('owner');
		dd.close();
	});

	test('upgrades editor → owner', async () => {
		const d = new Database(dbPath);
		d.run("INSERT INTO user (id, email, name, isInstallAdmin) VALUES ('u-1', 'a@x.test', 'A', 0)");
		d.run(
			"INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES ('m-1', 'u-1', 'site-a', 'editor', ?1, NULL)",
			[Date.now()]
		);
		d.close();
		const r = await runCli(['--email', 'a@x.test', '--space', 'site-a']);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatch(/Upgraded/);
		const dd = new Database(dbPath);
		const row = dd.query('SELECT role FROM member WHERE user_id = ?1').get('u-1');
		expect((row as { role: string }).role).toBe('owner');
		dd.close();
	});

	test('refuses on install-admin (no-op)', async () => {
		const d = new Database(dbPath);
		d.run(
			"INSERT INTO user (id, email, name, isInstallAdmin) VALUES ('admin-1', 'a@x.test', 'A', 1)"
		);
		d.close();
		const r = await runCli(['--email', 'a@x.test', '--space', 'site-a']);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatch(/install-admin/);
		const dd = new Database(dbPath);
		const n = dd.query('SELECT COUNT(*) AS n FROM member').get();
		expect((n as { n: number }).n).toBe(0);
		dd.close();
	});

	test('exits non-zero on unknown email', async () => {
		const r = await runCli(['--email', 'nope@x.test', '--space', 'site-a']);
		expect(r.code).toBe(1);
		expect(r.stderr).toMatch(/no user/);
	});

	test('rejects malformed slug', async () => {
		const r = await runCli(['--email', 'a@x.test', '--space', 'BadSlug']);
		expect(r.code).toBe(2);
		expect(r.stderr).toMatch(/invalid slug/);
	});

	test('idempotent on already-owner', async () => {
		const d = new Database(dbPath);
		d.run("INSERT INTO user (id, email, name, isInstallAdmin) VALUES ('u-1', 'a@x.test', 'A', 0)");
		d.run(
			"INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES ('m-1', 'u-1', 'site-a', 'owner', ?1, NULL)",
			[Date.now()]
		);
		d.close();
		const r = await runCli(['--email', 'a@x.test', '--space', 'site-a']);
		expect(r.code).toBe(0);
		expect(r.stdout).toMatch(/already owner/);
	});
});
