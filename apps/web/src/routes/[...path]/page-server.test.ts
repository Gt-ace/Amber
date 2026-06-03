/**
 * Public render path canEdit / editHref — DB-seeded integration tests.
 *
 * These tests verify that `canEdit(event, slug)` (not the old `isAuthor`)
 * correctly gates the "Edit this page" link for install-admins, space
 * editors, non-member signed-in users, and signed-out visitors.
 *
 * They seed a real auth.db in a temp workdir so that `getRole()` can query
 * the `member` table. Each test gets a fresh workdir via `beforeEach` /
 * `afterEach` to isolate the auth singleton.
 *
 * The existing `page.test.ts` covers cases that don't need a DB (signed-out
 * and install-admin, both of which short-circuit before `getRole` is called).
 * This file covers the DB-dependent cases: space editor and non-member.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdirSync, rmSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations } from '$lib/server/auth-migrations';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

// Use a counter suffix so slugs are lowercase-only (mkdtempSync may produce
// uppercase chars that fail the `^[a-z0-9][a-z0-9-]{0,62}$` slug regex).
let testCounter = 0;

let workDir: string;
let slug: string;

beforeEach(async () => {
	testCounter++;
	// Build a deterministic, lowercase-only path so the slug regex accepts it.
	workDir = join(tmpdir(), `amber-ps-test-${testCounter}`);
	rmSync(workDir, { recursive: true, force: true });
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });
	mkdirSync(join(workDir, '.amber'), { recursive: true });

	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	process.env.AMBER_PUBLIC_URL = 'http://localhost:5173';
	slug = basename(workDir);

	// Seed auth.db with the better-auth user table (hand-crafted — tests don't
	// need better-auth's full migration runner) plus Amber's own migrations.
	const db = new Database(join(workDir, '.amber', 'auth.db'));
	db.exec('PRAGMA journal_mode = WAL;');
	db.exec('PRAGMA foreign_keys = ON;');
	db.exec(`CREATE TABLE user (
		id TEXT PRIMARY KEY,
		name TEXT,
		email TEXT NOT NULL UNIQUE,
		emailVerified INTEGER NOT NULL DEFAULT 0,
		image TEXT,
		createdAt INTEGER NOT NULL,
		updatedAt INTEGER NOT NULL
	);`);
	applyAmberAuthMigrations(db);
	const now = Date.now();
	// install-admin user
	db.run(
		'INSERT INTO user (id, name, email, isInstallAdmin, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)',
		['admin', null, 'a@x.test', now, now]
	);
	// space editor — has a member row for this space
	db.run(
		'INSERT INTO user (id, name, email, isInstallAdmin, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)',
		['editor', null, 'e@x.test', now, now]
	);
	// stranger — authenticated but has no member row
	db.run(
		'INSERT INTO user (id, name, email, isInstallAdmin, createdAt, updatedAt) VALUES (?, ?, ?, 0, ?, ?)',
		['stranger', null, 's@x.test', now, now]
	);
	db.run('INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)', [
		crypto.randomUUID(),
		'editor',
		slug,
		'editor',
		now
	]);
	db.close();

	// Initialise the space singleton against the temp workdir.
	const { getSpace } = await import('$lib/server/space');
	getSpace();
});

afterEach(async () => {
	const { _resetAuthSingleton } = await import('$lib/server/auth-config');
	const spaceMod = await import('$lib/server/space');
	if (typeof spaceMod.__resetRegistryForTests === 'function') {
		await spaceMod.__resetRegistryForTests();
	}
	_resetAuthSingleton();
	rmSync(workDir, { recursive: true, force: true });
});

async function loadFor(
	user: { id: string; isInstallAdmin: boolean; email?: string } | null,
	pagePath = 'about'
) {
	const { getSpace } = await import('$lib/server/space');
	const space = getSpace();
	const { load } = await import('./+page.server.ts');
	const event = {
		params: { path: pagePath },
		locals: {
			user: user
				? {
						id: user.id,
						isInstallAdmin: user.isInstallAdmin,
						email: user.email ?? 'x@x.test',
						name: null
					}
				: null,
			space,
			mountPath: '/',
			mountPrefix: '',
			access: null,
			role: null
		}
	} as unknown as Parameters<typeof load>[0];
	return load(event) as { canEdit: boolean; editHref: string | null };
}

describe('public render path canEdit probe', () => {
	test('install-admin → canEdit true, editHref set', async () => {
		const data = await loadFor({ id: 'admin', isInstallAdmin: true });
		expect(data.canEdit).toBe(true);
		expect(data.editHref).toBe(`/admin/spaces/${slug}/edit/about`);
	});

	test('space editor → canEdit true, editHref set', async () => {
		const data = await loadFor({ id: 'editor', isInstallAdmin: false });
		expect(data.canEdit).toBe(true);
		expect(data.editHref).toContain(`/admin/spaces/${slug}/edit`);
	});

	test('stranger (non-member) → canEdit false, editHref null', async () => {
		const data = await loadFor({ id: 'stranger', isInstallAdmin: false });
		expect(data.canEdit).toBe(false);
		expect(data.editHref).toBeNull();
	});

	test('signed-out → canEdit false, editHref null', async () => {
		const data = await loadFor(null);
		expect(data.canEdit).toBe(false);
		expect(data.editHref).toBeNull();
	});

	test('root URL → editHref has no trailing slash', async () => {
		const data = await loadFor({ id: 'admin', isInstallAdmin: true }, '');
		expect(data.canEdit).toBe(true);
		expect(data.editHref).toBe(`/admin/spaces/${slug}/edit`);
		expect(data.editHref).not.toMatch(/\/$/);
	});
});
