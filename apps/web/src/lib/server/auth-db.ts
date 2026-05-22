/**
 * Opens `.amber/auth.db` via `bun:sqlite` and hands the `Database` handle to
 * better-auth (spec §5, §10).
 *
 * Separate file from `lib/space/cache.ts` so the two SQLite handles never
 * tangle — cache.db is regenerable runtime state, auth.db is **not** (the
 * narrowing of the `.amber/` rule this subsystem lands; see CLAUDE.md §12).
 *
 * Path:
 *   - `<AMBER_SPACE_PATH>/.amber/auth.db` in single-space mode.
 *   - `<AMBER_SPACES_DIR>/.amber/auth.db` in multi-space mode (v0.5
 *     subsystem 3). auth.db is install-level state — one admin across every
 *     space — so it lives at the install root (the parent dir of the spaces),
 *     not inside any one space.
 *
 * The directory is created if missing. WAL mode is enabled to match the
 * cache handle and to keep single-writer serialization predictable for the
 * setup-time race (spec §3, §9).
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function authDbPath(spacePath?: string): string {
	const space = spacePath ?? process.env.AMBER_SPACE_PATH ?? process.env.AMBER_SPACES_DIR;
	if (!space) {
		throw new Error(
			'AMBER_SPACE_PATH (single-space) or AMBER_SPACES_DIR (multi-space) ' +
				'is required to locate .amber/auth.db'
		);
	}
	return resolve(space, '.amber', 'auth.db');
}

export function openAuthDb(path: string): Database {
	mkdirSync(dirname(path), { recursive: true });
	const db = new Database(path);
	db.exec('PRAGMA journal_mode = WAL;');
	db.exec('PRAGMA foreign_keys = ON;');
	return db;
}
