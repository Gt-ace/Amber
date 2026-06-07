/**
 * Hand-written migration runner for Amber's additions to `auth.db` (spec §5).
 *
 * Better-auth owns its own Kysely-driven migrations; Amber's go on top via a
 * tiny ledger table and a hand-curated list of SQL strings. The runner is
 * idempotent: it skips any id already in the ledger.
 *
 * If the ledger contains an id this build doesn't know about, we refuse to
 * boot — that's the "auth-DB schema is newer than this Amber build" gate
 * from spec §5. The operator either upgrades the build or restores an older
 * `auth.db`.
 *
 * Subsystem 4 lands three migrations: the `isInstallAdmin` column on `user`,
 * the `member` table, and the `invite` table. Subsequent subsystems append
 * to `MIGRATIONS` rather than editing existing entries; ids are
 * monotonically sortable so the order is unambiguous.
 */

import type { Database } from 'bun:sqlite';

export interface Migration {
	id: string;
	sql: string;
}

export const MIGRATIONS: Migration[] = [
	{
		id: '0001_user_is_install_admin',
		sql: 'ALTER TABLE user ADD COLUMN isInstallAdmin INTEGER NOT NULL DEFAULT 0;'
	},
	{
		id: '0002_member_table',
		sql: `
			CREATE TABLE member (
				id          TEXT PRIMARY KEY,
				user_id     TEXT NOT NULL,
				space_slug  TEXT NOT NULL,
				role        TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
				created_at  INTEGER NOT NULL,
				created_by  TEXT,
				UNIQUE (user_id, space_slug)
			);
			CREATE INDEX member_by_user  ON member(user_id);
			CREATE INDEX member_by_space ON member(space_slug);
		`
	},
	{
		id: '0003_invite_table',
		sql: `
			CREATE TABLE invite (
				id          TEXT PRIMARY KEY,
				token_hash  TEXT NOT NULL UNIQUE,
				space_slug  TEXT NOT NULL,
				role        TEXT NOT NULL CHECK (role IN ('owner', 'editor')),
				expires_at  INTEGER NOT NULL,
				created_at  INTEGER NOT NULL,
				created_by  TEXT NOT NULL,
				redeemed_at INTEGER,
				redeemed_by TEXT
			);
			CREATE INDEX invite_by_space   ON invite(space_slug);
			CREATE INDEX invite_by_expires ON invite(expires_at);
		`
	},
	{
		// Structural backstop for the install-admin bootstrap race (security
		// follow-up H4): a partial unique index that lets at most one user row
		// carry isInstallAdmin = 1. Even if two concurrent /admin/setup requests
		// both create a user, only one can be promoted; the second promotion
		// hits this index. Existing installs have exactly one admin, so the
		// index builds cleanly on upgrade.
		id: '0004_one_install_admin',
		sql: 'CREATE UNIQUE INDEX one_install_admin ON user(isInstallAdmin) WHERE isInstallAdmin = 1;'
	}
];

export function applyAmberAuthMigrations(db: Database): void {
	db.exec(
		'CREATE TABLE IF NOT EXISTS amber_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);'
	);

	const knownIds = new Set(MIGRATIONS.map((m) => m.id));
	const appliedRows = db.query('SELECT id FROM amber_migrations').all() as Array<{ id: string }>;
	const appliedIds = new Set(appliedRows.map((r) => r.id));

	for (const applied of appliedIds) {
		if (!knownIds.has(applied)) {
			throw new Error(
				`auth-DB schema is newer than this Amber build (saw migration "${applied}" in ` +
					`amber_migrations that this build does not ship). Upgrade Amber, or restore an ` +
					`older auth.db from backup.`
			);
		}
	}

	const insert = db.prepare('INSERT INTO amber_migrations (id, applied_at) VALUES (?, ?)');
	for (const migration of MIGRATIONS) {
		if (appliedIds.has(migration.id)) continue;
		db.transaction(() => {
			db.exec(migration.sql);
			insert.run(migration.id, Date.now());
		})();
	}
}
