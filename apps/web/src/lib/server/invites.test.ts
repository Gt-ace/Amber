import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { Database } from 'bun:sqlite';
import {
	hashToken,
	generateInviteToken,
	insertInvite,
	loadValidByTokenHash,
	markRedeemed,
	revokeInvite,
	listPendingForSpace
} from './invites';
import { applyAmberAuthMigrations } from './auth-migrations';

let db: Database;

beforeEach(() => {
	db = new Database(':memory:');
	// Stand in for better-auth's `user` table; only the FK shape matters for
	// these tests (member/invite do not declare FKs). Do NOT include
	// isInstallAdmin here — migration 0001 adds that column via ALTER TABLE.
	db.exec(
		'CREATE TABLE user (id TEXT PRIMARY KEY, email TEXT, createdAt INTEGER NOT NULL DEFAULT 0, updatedAt INTEGER NOT NULL DEFAULT 0);'
	);
	applyAmberAuthMigrations(db);
});

afterEach(() => {
	db.close();
});

describe('hashToken', () => {
	test('is deterministic and hex-shaped', () => {
		const a = hashToken('hello');
		const b = hashToken('hello');
		expect(a).toBe(b);
		expect(a).toMatch(/^[0-9a-f]{64}$/);
	});

	test('changes when the input changes', () => {
		expect(hashToken('a')).not.toBe(hashToken('b'));
	});
});

describe('generateInviteToken', () => {
	test('is 43 chars (base64url of 32 bytes, no padding)', () => {
		const t = generateInviteToken();
		expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
	});

	test('is unique on repeat calls (collision-free in practice)', () => {
		const a = generateInviteToken();
		const b = generateInviteToken();
		expect(a).not.toBe(b);
	});
});

describe('insertInvite + loadValidByTokenHash', () => {
	test('round-trips a fresh invite', () => {
		const { id, token } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin-1'
		});
		const row = loadValidByTokenHash(db, hashToken(token));
		expect(row?.id).toBe(id);
		expect(row?.role).toBe('editor');
		expect(row?.redeemed_at).toBeNull();
	});

	test('returns null for an unknown token', () => {
		expect(loadValidByTokenHash(db, hashToken('nope'))).toBeNull();
	});

	test('returns null once redeemed', () => {
		const { id, token } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin-1'
		});
		markRedeemed(db, { id, userId: 'u-2' });
		expect(loadValidByTokenHash(db, hashToken(token))).toBeNull();
	});

	test('returns null once expired', () => {
		const { token } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin-1'
		});
		// Force expiry in the row.
		db.run('UPDATE invite SET expires_at = 0');
		expect(loadValidByTokenHash(db, hashToken(token))).toBeNull();
	});
});

describe('revokeInvite', () => {
	test('deletes a pending invite', () => {
		const { id, token } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin-1'
		});
		revokeInvite(db, id);
		expect(loadValidByTokenHash(db, hashToken(token))).toBeNull();
	});

	test('does not delete a redeemed invite (preserves history)', () => {
		const { id } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin-1'
		});
		markRedeemed(db, { id, userId: 'u-2' });
		revokeInvite(db, id);
		const row = db.query('SELECT * FROM invite WHERE id = ?1').get(id);
		expect(row).not.toBeUndefined();
	});
});

describe('listPendingForSpace', () => {
	test('returns pending invites for the slug, newest first', () => {
		// Insert with explicit created_at values to guarantee ordering even when
		// Date.now() doesn't advance between synchronous calls.
		const now = Date.now();
		const { id: id1 } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin-1'
		});
		db.run('UPDATE invite SET created_at = ?1 WHERE id = ?2', [now, id1]);
		insertInvite(db, { spaceSlug: 'site-b', role: 'owner', createdBy: 'admin-1' });
		const { id: id2 } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'owner',
			createdBy: 'admin-1'
		});
		db.run('UPDATE invite SET created_at = ?1 WHERE id = ?2', [now + 1, id2]);
		const pending = listPendingForSpace(db, 'site-a');
		expect(pending.length).toBe(2);
		expect(pending[0].id).toBe(id2);
	});

	test('excludes redeemed and expired invites', () => {
		const { id } = insertInvite(db, {
			spaceSlug: 'site-a',
			role: 'editor',
			createdBy: 'admin-1'
		});
		markRedeemed(db, { id, userId: 'u-2' });
		expect(listPendingForSpace(db, 'site-a')).toEqual([]);
	});
});
