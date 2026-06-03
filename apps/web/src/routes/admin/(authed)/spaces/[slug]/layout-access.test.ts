/**
 * Per-space layout access matrix (spec §3). Throwaway auth.db, seeded
 * directly (no better-auth round-trip) so the test stays a single
 * `requireSpaceAccess` call wide.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations } from '$lib/server/auth-migrations';

const FIXTURE = fileURLToPath(
	new URL('../../../../../../fixtures/example-space/', import.meta.url)
);

let workDir: string;
let slug: string;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-layout-'));
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });
	mkdirSync(join(workDir, '.amber'), { recursive: true });

	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	process.env.AMBER_PUBLIC_URL = 'http://localhost:5173';

	slug = basename(workDir);

	const db = new Database(join(workDir, '.amber', 'auth.db'));
	db.exec(`
		CREATE TABLE user (
			id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT,
			emailVerified INTEGER NOT NULL DEFAULT 0,
			createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
		);
	`);
	applyAmberAuthMigrations(db);
	const now = Date.now();
	db.run(
		'INSERT INTO user (id, email, isInstallAdmin, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?)',
		['admin', 'a@x.test', now, now]
	);
	db.run('INSERT INTO user (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)', [
		'editor',
		'e@x.test',
		now,
		now
	]);
	db.run('INSERT INTO user (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)', [
		'stranger',
		's@x.test',
		now,
		now
	]);
	db.run('INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)', [
		'm',
		'editor',
		slug,
		'editor',
		now
	]);
	db.close();

	// Prime the registry so getRegistryEntries() finds the space by slug.
	const { getSpace } = await import('$lib/server/space');
	getSpace();
});

afterEach(async () => {
	const { _resetAuthSingleton } = await import('$lib/server/auth-config');
	const { __resetRegistryForTests } = await import('$lib/server/space');
	await __resetRegistryForTests();
	_resetAuthSingleton();
	rmSync(workDir, { recursive: true, force: true });
});

function eventFor(user: { id: string; isInstallAdmin: boolean } | null) {
	return {
		params: { slug },
		locals: {
			user: user ? { ...user, email: 'x@x', name: null } : null,
			access: null,
			role: null,
			space: null,
			mountPath: null
		}
	} as unknown as Parameters<typeof import('./+layout.server.ts').load>[0];
}

describe('per-space layout access', () => {
	test('install-admin sees any loaded slug', async () => {
		const { load } = await import('./+layout.server.ts');
		const data = await load(eventFor({ id: 'admin', isInstallAdmin: true }));
		expect(data?.role).toBe('install-admin');
	});

	test('editor sees their own slug', async () => {
		const { load } = await import('./+layout.server.ts');
		const data = await load(eventFor({ id: 'editor', isInstallAdmin: false }));
		expect(data?.role).toBe('editor');
	});

	test('non-member of a real slug → 404', async () => {
		const { load } = await import('./+layout.server.ts');
		try {
			await load(eventFor({ id: 'stranger', isInstallAdmin: false }));
			expect.unreachable('should have thrown 404');
		} catch (e) {
			expect((e as { status: number }).status).toBe(404);
		}
	});

	test('signed-out → 401 (the (authed) layout wraps this into a redirect)', async () => {
		const { load } = await import('./+layout.server.ts');
		try {
			await load(eventFor(null));
			expect.unreachable('should have thrown 401');
		} catch (e) {
			expect((e as { status: number }).status).toBe(401);
		}
	});
});
