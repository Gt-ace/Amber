#!/usr/bin/env bun
/**
 * grant-ownership — offline grant of `owner` role on a space (spec §10).
 *
 * Mirrors `reset-password.ts`: opens `auth.db` directly, looks up the user
 * by email, refuses if `isInstallAdmin = 1` (they already implicitly own
 * everything), and inserts or upgrades a `member` row to role `owner`.
 *
 * Usage:
 *   bun run --cwd apps/web bin/grant-ownership.ts --email <addr> --space <slug>
 */

import { Database } from 'bun:sqlite';
import { authDbPath } from '../src/lib/server/auth-db';

function arg(name: string): string | null {
	const i = process.argv.indexOf(`--${name}`);
	if (i === -1) return null;
	const v = process.argv[i + 1];
	return v && !v.startsWith('--') ? v : null;
}

function newMemberId(): string {
	return crypto.randomUUID();
}

async function main() {
	const email = arg('email');
	const slug = arg('space');
	if (!email || !slug) {
		console.error('usage: grant-ownership --email <addr> --space <slug>');
		process.exit(2);
	}
	if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) {
		console.error(`invalid slug "${slug}" (must match ^[a-z0-9][a-z0-9-]{0,62}$)`);
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

	const user = db.query('SELECT id, isInstallAdmin FROM user WHERE email = ?1').get(email) as
		| { id: string; isInstallAdmin: number }
		| undefined;
	if (!user) {
		console.error(`no user with email ${email}`);
		process.exit(1);
	}
	if (user.isInstallAdmin) {
		console.log(
			`${email} is the install-admin; they already implicitly own every space. No row inserted.`
		);
		process.exit(0);
	}

	const existing = db
		.query('SELECT id, role FROM member WHERE user_id = ?1 AND space_slug = ?2')
		.get(user.id, slug) as { id: string; role: string } | undefined;
	const now = Date.now();
	if (existing) {
		if (existing.role === 'owner') {
			console.log(`${email} is already owner on ${slug}. Nothing to do.`);
			process.exit(0);
		}
		db.run('UPDATE member SET role = ?1 WHERE id = ?2', ['owner', existing.id]);
		console.log(`Upgraded ${email} from ${existing.role} to owner on ${slug}.`);
		process.exit(0);
	}
	db.run(
		'INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES (?1, ?2, ?3, ?4, ?5, NULL)',
		[newMemberId(), user.id, slug, 'owner', now]
	);
	console.log(`Granted owner on ${slug} to ${email}.`);
}

await main();
