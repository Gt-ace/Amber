/**
 * Tests for the hand-written migration runner. No better-auth, no real
 * auth.db — just a throwaway bun:sqlite handle (spec §5).
 */

import { describe, expect, test } from 'vitest';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations, MIGRATIONS } from './auth-migrations';

function freshDb(): Database {
	const db = new Database(':memory:');
	db.exec('PRAGMA journal_mode = WAL;');
	// Better-auth would have created `user` before applyAmberAuthMigrations()
	// runs in production. Seed a minimal stub here so migration 0001 has a
	// table to ALTER. Matches the pattern used by invites.test.ts later in
	// the plan.
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
	return db;
}

describe('applyAmberAuthMigrations()', () => {
	test('creates the amber_migrations ledger table on first run', () => {
		const db = freshDb();
		applyAmberAuthMigrations(db);
		const row = db
			.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'amber_migrations'")
			.get();
		expect(row).toBeDefined();
	});

	test('records every migration id after a clean run', () => {
		const db = freshDb();
		applyAmberAuthMigrations(db);
		const rows = db
			.query('SELECT id FROM amber_migrations ORDER BY applied_at ASC')
			.all() as Array<{ id: string }>;
		expect(rows.map((r) => r.id)).toEqual(MIGRATIONS.map((m) => m.id));
	});

	test('is idempotent — second run is a no-op', () => {
		const db = freshDb();
		applyAmberAuthMigrations(db);
		const before = db.query('SELECT COUNT(*) AS n FROM amber_migrations').get() as { n: number };
		applyAmberAuthMigrations(db);
		const after = db.query('SELECT COUNT(*) AS n FROM amber_migrations').get() as { n: number };
		expect(after.n).toBe(before.n);
	});

	test('throws when the DB has a migration id not in the build', () => {
		const db = freshDb();
		applyAmberAuthMigrations(db);
		// Simulate "newer DB": insert a migration id the running build doesn't
		// know about. The next call must refuse to proceed.
		db.run('INSERT INTO amber_migrations (id, applied_at) VALUES (?, ?)', [
			'9999_from_the_future',
			Date.now()
		]);
		expect(() => applyAmberAuthMigrations(db)).toThrow(/auth-DB schema is newer/);
	});

	test('applies in order even when MIGRATIONS contains multiple entries', () => {
		// Synthetic check — proves the runner doesn't reorder.
		const db = freshDb();
		applyAmberAuthMigrations(db);
		const ids = (
			db.query('SELECT id FROM amber_migrations ORDER BY applied_at ASC').all() as Array<{
				id: string;
			}>
		).map((r) => r.id);
		// Each id is a sorted-prefix string; the lexicographic order has to match
		// the applied order.
		expect(ids).toEqual([...ids].sort());
	});
});

describe('migration 0001 — isInstallAdmin', () => {
	test('adds column with default 0 on a pre-existing user row', () => {
		const db = new Database(':memory:');
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
		db.run('INSERT INTO user (id, email, name, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?)', [
			'u1',
			'a@x.test',
			'A',
			Date.now(),
			Date.now()
		]);

		applyAmberAuthMigrations(db);

		const row = db.query('SELECT isInstallAdmin FROM user WHERE id = ?').get('u1') as
			| { isInstallAdmin: number }
			| undefined;
		expect(row?.isInstallAdmin).toBe(0);
	});

	test('column is queryable on a fresh insert with the flag set', () => {
		const db = new Database(':memory:');
		db.exec(`
			CREATE TABLE user (
				id TEXT PRIMARY KEY,
				email TEXT NOT NULL UNIQUE,
				createdAt INTEGER NOT NULL,
				updatedAt INTEGER NOT NULL
			);
		`);
		applyAmberAuthMigrations(db);
		db.run(
			'INSERT INTO user (id, email, isInstallAdmin, createdAt, updatedAt) VALUES (?, ?, 1, ?, ?)',
			['u2', 'b@x.test', Date.now(), Date.now()]
		);
		const row = db.query('SELECT isInstallAdmin FROM user WHERE id = ?').get('u2') as {
			isInstallAdmin: number;
		};
		expect(row.isInstallAdmin).toBe(1);
	});
});

describe('migration 0002 — member table', () => {
	test('table and both indexes exist after applying', () => {
		const db = freshDb();
		applyAmberAuthMigrations(db);
		const tbl = db
			.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'member'")
			.get();
		expect(tbl).toBeDefined();
		const idxs = db
			.query(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'member' ORDER BY name"
			)
			.all() as Array<{ name: string }>;
		const names = idxs.map((i) => i.name);
		expect(names).toContain('member_by_user');
		expect(names).toContain('member_by_space');
	});

	test('role CHECK constraint enforces owner|editor', () => {
		const db = freshDb();
		applyAmberAuthMigrations(db);
		expect(() =>
			db.run(
				'INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)',
				['m1', 'u1', 'site-a', 'admin', Date.now()]
			)
		).toThrow();
	});

	test('UNIQUE (user_id, space_slug) blocks duplicate rows', () => {
		const db = freshDb();
		applyAmberAuthMigrations(db);
		const now = Date.now();
		db.run(
			'INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)',
			['m1', 'u1', 'site-a', 'editor', now]
		);
		expect(() =>
			db.run(
				'INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)',
				['m2', 'u1', 'site-a', 'owner', now]
			)
		).toThrow();
	});
});

describe('migration 0003 — invite table', () => {
	test('table exists with every required column', () => {
		const db = freshDb();
		applyAmberAuthMigrations(db);
		const cols = db.query("PRAGMA table_info('invite')").all() as Array<{ name: string }>;
		const names = cols.map((c) => c.name).sort();
		expect(names).toEqual(
			[
				'created_at',
				'created_by',
				'expires_at',
				'id',
				'redeemed_at',
				'redeemed_by',
				'role',
				'space_slug',
				'token_hash'
			].sort()
		);
	});

	test('token_hash is unique', () => {
		const db = freshDb();
		applyAmberAuthMigrations(db);
		const now = Date.now();
		db.run(
			'INSERT INTO invite (id, token_hash, space_slug, role, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
			['i1', 'hash1', 'site-a', 'editor', now + 7 * 86_400_000, now, 'u1']
		);
		expect(() =>
			db.run(
				'INSERT INTO invite (id, token_hash, space_slug, role, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
				['i2', 'hash1', 'site-a', 'editor', now + 7 * 86_400_000, now, 'u1']
			)
		).toThrow();
	});

	test('role CHECK constraint enforces owner|editor', () => {
		const db = freshDb();
		applyAmberAuthMigrations(db);
		const now = Date.now();
		expect(() =>
			db.run(
				'INSERT INTO invite (id, token_hash, space_slug, role, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
				['i1', 'h', 's', 'admin', now, now, 'u1']
			)
		).toThrow();
	});
});
