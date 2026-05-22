#!/usr/bin/env bun
/**
 * reset-password — offline password reset for the AGPL self-hoster
 * (spec §7).
 *
 * Opens `<AMBER_SPACE_PATH>/.amber/auth.db` directly, generates a random
 * temporary password, writes a hash in better-auth's format, and revokes
 * every session for the user so any live cookies stop working. Prints the
 * temporary password to stdout once. The operator signs in, then changes it
 * from /admin/account.
 *
 * Usage:
 *   bun run --cwd apps/web bin/reset-password.ts --email <addr>
 *
 * Env (exactly one, mirroring the server's discovery rule):
 *   AMBER_SPACE_PATH (single-space) — points at the space directory.
 *   AMBER_SPACES_DIR (multi-space)  — points at the install root, whose
 *                                     `.amber/auth.db` is shared across
 *                                     every loaded space.
 *
 * The CLI is the deliberate escape hatch for the self-hoster with shell
 * access. There is no in-app forgot-password flow by design.
 */

import { Database } from 'bun:sqlite';
import { hashPassword } from 'better-auth/crypto';
import { authDbPath } from '../src/lib/server/auth-db';

function arg(name: string): string | null {
	const i = process.argv.indexOf(`--${name}`);
	if (i === -1) return null;
	const v = process.argv[i + 1];
	return v && !v.startsWith('--') ? v : null;
}

function randomPassword(): string {
	// 24 chars from URL-safe alphabet ≈ 142 bits of entropy.
	const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
	const buf = crypto.getRandomValues(new Uint8Array(24));
	return Array.from(buf, (b) => alphabet[b % alphabet.length]).join('');
}

async function main() {
	const email = arg('email');
	if (!email) {
		console.error('usage: reset-password --email <addr>');
		process.exit(2);
	}
	let dbPath: string;
	try {
		dbPath = authDbPath();
	} catch (e) {
		console.error((e as Error).message);
		process.exit(2);
	}
	const db = new Database(dbPath);

	const user = db.query('SELECT id FROM user WHERE email = ?1').get(email) as
		| { id: string }
		| undefined;
	if (!user) {
		console.error(`no user with email ${email}`);
		process.exit(1);
	}

	const account = db
		.query("SELECT id FROM account WHERE userId = ?1 AND providerId = 'credential'")
		.get(user.id) as { id: string } | undefined;

	const tempPassword = randomPassword();
	const hash = await hashPassword(tempPassword);
	const now = new Date().toISOString();

	db.transaction(() => {
		if (account) {
			db.run('UPDATE account SET password = ?1, updatedAt = ?2 WHERE id = ?3', [
				hash,
				now,
				account.id
			]);
		} else {
			const accountId = crypto.randomUUID();
			db.run(
				'INSERT INTO account (id, accountId, providerId, userId, password, createdAt, updatedAt) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)',
				[accountId, user.id, 'credential', user.id, hash, now, now]
			);
		}
		db.run('DELETE FROM session WHERE userId = ?1', [user.id]);
	})();

	console.log(`Password reset for ${email}.`);
	console.log(`Temporary password: ${tempPassword}`);
	console.log('Sign in and change it from /admin/account.');
}

await main();
