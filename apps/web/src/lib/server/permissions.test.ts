/**
 * Unit tests for the permission seam (spec §3). Throwaway auth.db, no
 * better-auth — we INSERT rows ourselves so the assertions cover every
 * branch of the matrix.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations } from './auth-migrations';
import { _resetAuthSingleton } from './auth-config';

let workDir: string;
let db: Database;

beforeEach(() => {
	workDir = mkdtempSync(join(tmpdir(), 'amber-perms-'));
	mkdirSync(join(workDir, '.amber'), { recursive: true });
	process.env.AMBER_SPACE_PATH = workDir;
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	process.env.AMBER_PUBLIC_URL = 'http://localhost:5173';

	// Build the schema bypassing better-auth so the tests don't need a Space.
	db = new Database(join(workDir, '.amber', 'auth.db'));
	db.exec(`
		CREATE TABLE user (
			id TEXT PRIMARY KEY,
			email TEXT NOT NULL UNIQUE,
			name TEXT,
			emailVerified INTEGER NOT NULL DEFAULT 0,
			createdAt INTEGER NOT NULL,
			updatedAt INTEGER NOT NULL
		);
	`);
	applyAmberAuthMigrations(db);
	const now = Date.now();
	db.run(
		'INSERT INTO user (id, email, name, isInstallAdmin, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)',
		['admin', 'admin@x.test', 'Admin', 1, now, now]
	);
	db.run('INSERT INTO user (id, email, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', [
		'owner',
		'owner@x.test',
		'O',
		now,
		now
	]);
	db.run('INSERT INTO user (id, email, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', [
		'editor',
		'editor@x.test',
		'E',
		now,
		now
	]);
	db.run('INSERT INTO user (id, email, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', [
		'stranger',
		'stranger@x.test',
		'S',
		now,
		now
	]);
	db.run('INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)', [
		'm1',
		'owner',
		'site-a',
		'owner',
		now
	]);
	db.run('INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)', [
		'm2',
		'editor',
		'site-a',
		'editor',
		now
	]);
});

afterEach(() => {
	// Reset the singleton so the NEXT test rebuilds against its own workDir.
	_resetAuthSingleton();
	try {
		db.close();
	} catch {
		// already closed
	}
	rmSync(workDir, { recursive: true, force: true });
});

type FakeUser = { id: string; email: string; name?: string | null; isInstallAdmin: boolean };

function eventFor(user: FakeUser | null) {
	const locals: Record<string, unknown> = { user, access: null, role: null };
	return { locals } as unknown as import('@sveltejs/kit').RequestEvent;
}

function userRow(id: string): FakeUser {
	const row = db.query('SELECT id, email, name, isInstallAdmin FROM user WHERE id = ?').get(id) as
		| { id: string; email: string; name: string | null; isInstallAdmin: number }
		| undefined;
	if (!row) throw new Error(`no user ${id}`);
	return { id: row.id, email: row.email, name: row.name, isInstallAdmin: !!row.isInstallAdmin };
}

describe('requireSpaceAccess()', () => {
	test('null user → 401', async () => {
		const { requireSpaceAccess } = await import('./permissions');
		expect(() => requireSpaceAccess(eventFor(null), 'site-a')).toThrowError(
			expect.objectContaining({ status: 401 })
		);
	});

	test('install-admin → kind: install-admin, role: install-admin, on any slug', async () => {
		const { requireSpaceAccess } = await import('./permissions');
		const ev = eventFor(userRow('admin'));
		requireSpaceAccess(ev, 'any-slug');
		expect(ev.locals.access).toEqual({ kind: 'install-admin' });
		expect(ev.locals.role).toBe('install-admin');
	});

	test('owner member → kind: member, role: owner', async () => {
		const { requireSpaceAccess } = await import('./permissions');
		const ev = eventFor(userRow('owner'));
		requireSpaceAccess(ev, 'site-a');
		expect(ev.locals.access).toEqual({ kind: 'member', role: 'owner' });
		expect(ev.locals.role).toBe('owner');
	});

	test('editor member → kind: member, role: editor', async () => {
		const { requireSpaceAccess } = await import('./permissions');
		const ev = eventFor(userRow('editor'));
		requireSpaceAccess(ev, 'site-a');
		expect(ev.locals.role).toBe('editor');
	});

	test('non-member → 404 (NOT 403; spec §3 disclosure choice)', async () => {
		const { requireSpaceAccess } = await import('./permissions');
		expect(() => requireSpaceAccess(eventFor(userRow('stranger')), 'site-a')).toThrowError(
			expect.objectContaining({ status: 404 })
		);
	});

	test('member but role-too-low → 403', async () => {
		const { requireSpaceAccess } = await import('./permissions');
		expect(() => requireSpaceAccess(eventFor(userRow('editor')), 'site-a', 'owner')).toThrowError(
			expect.objectContaining({ status: 403 })
		);
	});

	test('install-admin passes owner gate', async () => {
		const { requireSpaceAccess } = await import('./permissions');
		const ev = eventFor(userRow('admin'));
		requireSpaceAccess(ev, 'site-a', 'owner');
		expect(ev.locals.role).toBe('install-admin');
	});
});

describe('canEdit()', () => {
	test('true for install-admin', async () => {
		const { canEdit } = await import('./permissions');
		const ev = eventFor(userRow('admin'));
		expect(canEdit(ev, 'site-a')).toBe(true);
	});

	test('true for owner', async () => {
		const { canEdit } = await import('./permissions');
		expect(canEdit(eventFor(userRow('owner')), 'site-a')).toBe(true);
	});

	test('true for editor', async () => {
		const { canEdit } = await import('./permissions');
		expect(canEdit(eventFor(userRow('editor')), 'site-a')).toBe(true);
	});

	test('false for non-member', async () => {
		const { canEdit } = await import('./permissions');
		expect(canEdit(eventFor(userRow('stranger')), 'site-a')).toBe(false);
	});

	test('false for signed-out', async () => {
		const { canEdit } = await import('./permissions');
		expect(canEdit(eventFor(null), 'site-a')).toBe(false);
	});
});

describe('canRead()', () => {
	test('true for install-admin on any slug', async () => {
		const { canRead } = await import('./permissions');
		expect(canRead(eventFor(userRow('admin')), 'unknown-slug')).toBe(true);
	});

	test('true for editor on their space', async () => {
		const { canRead } = await import('./permissions');
		expect(canRead(eventFor(userRow('editor')), 'site-a')).toBe(true);
	});

	test('false for non-member', async () => {
		const { canRead } = await import('./permissions');
		expect(canRead(eventFor(userRow('stranger')), 'site-a')).toBe(false);
	});
});

describe('CRUD helpers', () => {
	test('getRole returns the role string or null', async () => {
		const { getRole } = await import('./permissions');
		expect(getRole('owner', 'site-a')).toBe('owner');
		expect(getRole('stranger', 'site-a')).toBeNull();
	});

	test('listMembers returns rows joined with user email', async () => {
		const { listMembers } = await import('./permissions');
		const rows = listMembers('site-a');
		const emails = rows.map((r) => r.email).sort();
		expect(emails).toEqual(['editor@x.test', 'owner@x.test']);
	});

	test('upsertMember inserts then updates role', async () => {
		const { upsertMember, getRole } = await import('./permissions');
		upsertMember('stranger', 'site-a', 'editor', 'admin');
		expect(getRole('stranger', 'site-a')).toBe('editor');
		upsertMember('stranger', 'site-a', 'owner', 'admin');
		expect(getRole('stranger', 'site-a')).toBe('owner');
	});

	test('removeMember deletes the row', async () => {
		const { removeMember, getRole } = await import('./permissions');
		removeMember('editor', 'site-a');
		expect(getRole('editor', 'site-a')).toBeNull();
	});

	test('markInstallAdmin promotes and returns true when no install admin exists', async () => {
		const { markInstallAdmin } = await import('./permissions');
		// Clear the fixture's pre-flagged admin so the install has no admin yet.
		db.run('UPDATE user SET isInstallAdmin = 0 WHERE email = ?', ['admin@x.test']);
		const ok = markInstallAdmin('owner@x.test');
		expect(ok).toBe(true);
		const row = db.query('SELECT isInstallAdmin FROM user WHERE email = ?').get('owner@x.test') as {
			isInstallAdmin: number;
		};
		expect(row.isInstallAdmin).toBe(1);
	});

	test('markInstallAdmin returns false and flags no one when an admin already exists', async () => {
		const { markInstallAdmin } = await import('./permissions');
		// Fixture already has admin@x.test flagged.
		const ok = markInstallAdmin('owner@x.test');
		expect(ok).toBe(false);
		const owner = db
			.query('SELECT isInstallAdmin FROM user WHERE email = ?')
			.get('owner@x.test') as { isInstallAdmin: number };
		expect(owner.isInstallAdmin).toBe(0);
		const flagged = db.query('SELECT COUNT(*) AS n FROM user WHERE isInstallAdmin = 1').get() as {
			n: number;
		};
		expect(flagged.n).toBe(1);
	});

	test('a partial unique index structurally forbids a second install admin', () => {
		// admin@x.test is already flagged; a raw second flag must hit the index.
		expect(() =>
			db.run('UPDATE user SET isInstallAdmin = 1 WHERE email = ?', ['owner@x.test'])
		).toThrow();
	});
});
