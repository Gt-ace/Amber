import { describe, expect, test } from 'vitest';
import { Database } from 'bun:sqlite';
import { applyAmberAuthMigrations } from './auth-migrations';
import { sweepExpiredInvites, scanOrphans } from './auth-boot';

function seededDb(): Database {
	const db = new Database(':memory:');
	db.exec(`
		CREATE TABLE user (
			id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
			createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
		);
	`);
	applyAmberAuthMigrations(db);
	return db;
}

describe('sweepExpiredInvites()', () => {
	test('deletes invites expired more than 30 days ago', () => {
		const db = seededDb();
		const now = Date.now();
		db.run(
			'INSERT INTO invite (id, token_hash, space_slug, role, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
			['old', 'h-old', 'site-a', 'editor', now - 31 * 86_400_000, now - 31 * 86_400_000, 'u1']
		);
		db.run(
			'INSERT INTO invite (id, token_hash, space_slug, role, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
			['fresh', 'h-fresh', 'site-a', 'editor', now + 7 * 86_400_000, now, 'u1']
		);
		const removed = sweepExpiredInvites(db, now);
		expect(removed).toBe(1);
		const remaining = db.query('SELECT id FROM invite').all() as Array<{ id: string }>;
		expect(remaining.map((r) => r.id)).toEqual(['fresh']);
	});

	test('deletes redeemed invites whose redeemed_at is more than 30 days old', () => {
		const db = seededDb();
		const now = Date.now();
		db.run(
			'INSERT INTO invite (id, token_hash, space_slug, role, expires_at, created_at, created_by, redeemed_at, redeemed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
			[
				'old-r',
				'h-old-r',
				'site-a',
				'editor',
				now + 86_400_000,
				now - 60 * 86_400_000,
				'u1',
				now - 31 * 86_400_000,
				'u2'
			]
		);
		const removed = sweepExpiredInvites(db, now);
		expect(removed).toBe(1);
	});

	test('keeps invites within the 30-day window', () => {
		const db = seededDb();
		const now = Date.now();
		db.run(
			'INSERT INTO invite (id, token_hash, space_slug, role, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
			['recent-exp', 'h', 'site-a', 'editor', now - 29 * 86_400_000, now - 36 * 86_400_000, 'u1']
		);
		expect(sweepExpiredInvites(db, now)).toBe(0);
	});
});

describe('scanOrphans()', () => {
	test('lists member rows whose slug is not in the loaded set', () => {
		const db = seededDb();
		const now = Date.now();
		db.run(
			'INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)',
			['m1', 'u1', 'ghost', 'editor', now]
		);
		db.run(
			'INSERT INTO member (id, user_id, space_slug, role, created_at) VALUES (?, ?, ?, ?, ?)',
			['m2', 'u2', 'site-a', 'owner', now]
		);
		const r = scanOrphans(db, new Set(['site-a']));
		expect(r.memberships).toEqual([{ slug: 'ghost', count: 1 }]);
	});

	test('lists pending invite rows whose slug is not in the loaded set', () => {
		const db = seededDb();
		const now = Date.now();
		db.run(
			'INSERT INTO invite (id, token_hash, space_slug, role, expires_at, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
			['i1', 'h1', 'ghost', 'editor', now + 86_400_000, now, 'u1']
		);
		const r = scanOrphans(db, new Set(['site-a']));
		expect(r.invites).toEqual([{ slug: 'ghost', count: 1 }]);
	});

	test('skips redeemed invites in the orphan scan (only pending invites count)', () => {
		const db = seededDb();
		const now = Date.now();
		db.run(
			'INSERT INTO invite (id, token_hash, space_slug, role, expires_at, created_at, created_by, redeemed_at, redeemed_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
			['i1', 'h1', 'ghost', 'editor', now + 86_400_000, now, 'u1', now, 'u2']
		);
		const r = scanOrphans(db, new Set([]));
		expect(r.invites).toEqual([]);
	});
});
