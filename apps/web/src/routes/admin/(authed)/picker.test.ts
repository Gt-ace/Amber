/**
 * Picker visibility tests (spec §2, §13). Mirrors the seeding pattern from
 * `spaces/[slug]/layout-access.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations } from '$lib/server/auth-migrations';

const FIXTURE = fileURLToPath(
	new URL('../../../../fixtures/example-space/', import.meta.url)
);

let workDir: string;
let slug: string;

beforeEach(async () => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-picker-'));
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
	db.run('INSERT INTO user (id, email, isInstallAdmin, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?)', [
		'admin', 'a@x.test', now, now
	]);
	db.run('INSERT INTO user (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)', [
		'editor', 'e@x.test', now, now
	]);
	db.run('INSERT INTO user (id, email, createdAt, updatedAt) VALUES (?, ?, ?, ?)', [
		'stranger', 's@x.test', now, now
	]);
	db.run(
		'INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)',
		['m', 'editor', slug, 'editor', now]
	);
	db.close();

	// Prime the registry so getRegistryEntries() returns the loaded space.
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
		locals: {
			user: user ? { ...user, email: 'x@x', name: null } : null,
			access: null,
			role: null,
			space: null,
			mountPath: null
		}
	} as unknown as Parameters<typeof import('./+page.server.ts').load>[0];
}

describe('/admin picker visibility', () => {
	test('install-admin: single-loaded-space → 302 to that slug', async () => {
		const { load } = await import('./+page.server.ts');
		try {
			await load(eventFor({ id: 'admin', isInstallAdmin: true }));
			expect.unreachable('should have redirected');
		} catch (e) {
			const r = e as { status: number; location: string };
			expect(r.status).toBe(302);
			expect(r.location).toBe(`/admin/spaces/${slug}`);
		}
	});

	test('editor with one membership → 302 to that slug', async () => {
		const { load } = await import('./+page.server.ts');
		try {
			await load(eventFor({ id: 'editor', isInstallAdmin: false }));
			expect.unreachable('should have redirected');
		} catch (e) {
			const r = e as { status: number; location: string };
			expect(r.status).toBe(302);
		}
	});

	test('non-member sees emptyState: no-memberships', async () => {
		const { load } = await import('./+page.server.ts');
		const data = await load(eventFor({ id: 'stranger', isInstallAdmin: false }));
		expect(data.spaces).toEqual([]);
		expect(data.emptyState).toBe('no-memberships');
	});
});
