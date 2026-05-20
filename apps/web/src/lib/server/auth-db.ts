/**
 * Opens `.amber/auth.db` via `bun:sqlite` and hands the `Database` handle to
 * better-auth (spec §5, §10).
 *
 * Separate file from `lib/space/cache.ts` so the two SQLite handles never
 * tangle — cache.db is regenerable runtime state, auth.db is **not** (the
 * narrowing of the `.amber/` rule this subsystem lands; see CLAUDE.md §12).
 *
 * Path: `<AMBER_SPACE_PATH>/.amber/auth.db`. The directory is created if
 * missing. WAL mode is enabled to match the cache handle and to keep
 * single-writer serialization predictable for the setup-time race
 * (spec §3, §9).
 */

import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export function authDbPath(spacePath?: string): string {
	const space = spacePath ?? process.env.AMBER_SPACE_PATH;
	if (!space) {
		throw new Error('AMBER_SPACE_PATH is required to locate .amber/auth.db');
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
