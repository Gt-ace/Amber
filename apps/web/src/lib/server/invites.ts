/**
 * Helpers around the `invite` table (spec §4, §5.3). One place owns the
 * crypto + SQL so the redemption route, the members admin, and the
 * cleanup sweep aren't each rolling their own.
 *
 * The token leaves the server exactly once (in the generate-invite action
 * payload). The DB stores the SHA-256 hash, never the bearer string.
 */

import { createHash, randomBytes } from 'node:crypto';
import type { Database } from 'bun:sqlite';
import type { SpaceRole } from '$lib/server/permissions';

export interface InviteRow {
	id: string;
	token_hash: string;
	space_slug: string;
	role: SpaceRole;
	expires_at: number;
	created_at: number;
	created_by: string;
	redeemed_at: number | null;
	redeemed_by: string | null;
}

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** SHA-256 → hex. The token is a high-entropy random string; no salt needed. */
export function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** 32 random bytes, base64url-encoded. ~256 bits of entropy. */
export function generateInviteToken(): string {
	return randomBytes(32).toString('base64url');
}

function newInviteId(): string {
	return crypto.randomUUID();
}

export function insertInvite(
	db: Database,
	args: { spaceSlug: string; role: SpaceRole; createdBy: string }
): { id: string; token: string; expiresAt: number } {
	const token = generateInviteToken();
	const id = newInviteId();
	const now = Date.now();
	const expiresAt = now + INVITE_TTL_MS;
	db.run(
		`INSERT INTO invite (id, token_hash, space_slug, role, expires_at, created_at, created_by)
		 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`,
		[id, hashToken(token), args.spaceSlug, args.role, expiresAt, now, args.createdBy]
	);
	return { id, token, expiresAt };
}

export function lookupByTokenHash(db: Database, tokenHash: string): InviteRow | null {
	const row = db.query('SELECT * FROM invite WHERE token_hash = ?1').get(tokenHash) as
		| InviteRow
		| undefined;
	return row ?? null;
}

export function lookupById(db: Database, id: string): InviteRow | null {
	const row = db.query('SELECT * FROM invite WHERE id = ?1').get(id) as InviteRow | undefined;
	return row ?? null;
}

/**
 * Returns the row inside a transaction, or null if it is invalid right now
 * (unknown / expired / already redeemed). Callers wrap their mutation in the
 * same transaction to close the redemption race.
 */
export function loadValidByTokenHash(db: Database, tokenHash: string): InviteRow | null {
	const row = lookupByTokenHash(db, tokenHash);
	if (!row) return null;
	if (row.redeemed_at != null) return null;
	if (row.expires_at < Date.now()) return null;
	return row;
}

export function markRedeemed(db: Database, args: { id: string; userId: string }): void {
	db.run('UPDATE invite SET redeemed_at = ?1, redeemed_by = ?2 WHERE id = ?3', [
		Date.now(),
		args.userId,
		args.id
	]);
}

export function revokeInvite(db: Database, id: string): void {
	db.run('DELETE FROM invite WHERE id = ?1 AND redeemed_at IS NULL', [id]);
}

export function listPendingForSpace(db: Database, spaceSlug: string): InviteRow[] {
	return db
		.query(
			`SELECT * FROM invite
			 WHERE space_slug = ?1 AND redeemed_at IS NULL AND expires_at >= ?2
			 ORDER BY created_at DESC`
		)
		.all(spaceSlug, Date.now()) as InviteRow[];
}
