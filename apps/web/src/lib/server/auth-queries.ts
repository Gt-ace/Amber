/**
 * Direct SQLite reads against `.amber/auth.db` for the few cases where the
 * better-auth API isn't the right shape (spec §3, §9):
 *
 *   - Setup/login load: "is there an admin yet?"
 *   - Setup action: race re-check inside the same transaction.
 *
 * These read the same handle the user-create hook uses (singleton-owned),
 * so SQLite's single-writer-under-WAL serialization is the bound on the
 * setup race window. Everything else routes through `auth.api.*`.
 */

import { getAuth, getAuthDb } from '$lib/server/auth-config';

/**
 * Async so that the first call ensures better-auth's migrations have run.
 * After the first call the underlying `getAuth()` is a no-op resolve.
 */
export async function adminCount(): Promise<number> {
	await getAuth();
	const db = getAuthDb();
	const row = db.query('SELECT COUNT(*) AS n FROM user').get() as { n: number } | undefined;
	return row?.n ?? 0;
}
