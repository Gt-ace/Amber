/**
 * One-shot boot helpers that run on the singleton DB after migrations have
 * applied (spec §4 expiry cleanup, §5 orphan-row log).
 *
 * Pure side effects against `auth.db`:
 *   - `sweepExpiredInvites(db)` deletes invite rows where `redeemed_at` or
 *     `expires_at` is more than 30 days old. Bounds table growth without
 *     erasing recent history (operators reading the table by hand can still
 *     see the last month).
 *   - `logOrphans(db, slugs)` scans for `member` / `invite` rows whose
 *     `space_slug` is not in the current registry. One log line per slug
 *     per table. Never auto-deletes.
 *
 * Both are idempotent: re-running sweep deletes nothing further if invoked
 * twice in the same boot; re-running orphan scan emits the same lines.
 */

import type { Database } from 'bun:sqlite';
import type { Logger } from '$lib/server/logger';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function sweepExpiredInvites(db: Database, now: number = Date.now()): number {
	const cutoff = now - THIRTY_DAYS_MS;
	const result = db.run(
		'DELETE FROM invite WHERE (redeemed_at IS NOT NULL AND redeemed_at < ?) OR (expires_at < ?)',
		[cutoff, cutoff]
	);
	return result.changes ?? 0;
}

export interface OrphanScanResult {
	memberships: Array<{ slug: string; count: number }>;
	invites: Array<{ slug: string; count: number }>;
}

export function scanOrphans(db: Database, loadedSlugs: Set<string>): OrphanScanResult {
	const memberRows = db
		.query('SELECT space_slug AS slug, COUNT(*) AS n FROM member GROUP BY space_slug')
		.all() as Array<{ slug: string; n: number }>;
	const inviteRows = db
		.query(
			'SELECT space_slug AS slug, COUNT(*) AS n FROM invite WHERE redeemed_at IS NULL GROUP BY space_slug'
		)
		.all() as Array<{ slug: string; n: number }>;

	return {
		memberships: memberRows
			.filter((r) => !loadedSlugs.has(r.slug))
			.map((r) => ({ slug: r.slug, count: r.n })),
		invites: inviteRows
			.filter((r) => !loadedSlugs.has(r.slug))
			.map((r) => ({ slug: r.slug, count: r.n }))
	};
}

export function logOrphans(log: Logger, result: OrphanScanResult): void {
	for (const o of result.memberships) {
		log.info({ code: 'orphan_membership', slug: o.slug, count: o.count }, 'orphan_membership');
	}
	for (const o of result.invites) {
		log.info({ code: 'orphan_invite', slug: o.slug, count: o.count }, 'orphan_invite');
	}
}
