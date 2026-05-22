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
