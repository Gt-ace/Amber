/**
 * The permission seam (spec §3, §6, §10).
 *
 * Owns:
 *   - `SpaceRole`, `ResolvedAccess` — the type vocabulary every consumer
 *     speaks.
 *   - `requireSpaceAccess(event, slug, minimumRole?)` — throwing guard used
 *     by the per-space `[slug]/+layout.server.ts` and the PUT save endpoint.
 *     Stashes the resolved access on `event.locals.access` / `.role` before
 *     returning. 401 on null user, 404 on missing-slug-OR-not-a-member, 403
 *     on member-but-role-too-low (spec §3 disclosure choice merges the first
 *     two into 404).
 *   - `canEdit(event, slug)` / `canRead(event, slug)` — non-throwing probes
 *     used by the public render path. Single `member` query for non-install-
 *     admin users.
 *   - Small CRUD helpers around the `member` table (`getRole`, `listMembers`,
 *     `upsertMember`, `removeMember`) — the only place outside this module
 *     allowed to mutate `member` rows is the migration runner. Every action
 *     in `/admin/spaces/[slug]/members/+page.server.ts` goes through here.
 *   - `markInstallAdmin(email)` — single-line helper called from the setup
 *     action and the Google bootstrap path. Idempotent.
 *
 * Pure reads of `event.locals.user`. The DB handle is the singleton from
 * `auth-config.ts`; we never open our own.
 */

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getAuthDb } from '$lib/server/auth-config';

export type SpaceRole = 'owner' | 'editor';

export type ResolvedAccess =
	| { kind: 'install-admin' }
	| { kind: 'member'; role: SpaceRole }
	| { kind: 'none' };

export function getRole(userId: string, slug: string): SpaceRole | null {
	const row = getAuthDb()
		.query('SELECT role FROM member WHERE user_id = ? AND space_slug = ?')
		.get(userId, slug) as { role: SpaceRole } | undefined;
	return row?.role ?? null;
}

export interface MemberListRow {
	id: string;
	userId: string;
	email: string;
	name: string | null;
	role: SpaceRole;
	createdAt: number;
}

export function listMembers(slug: string): MemberListRow[] {
	return getAuthDb()
		.query(
			`SELECT member.id, member.user_id AS userId, user.email, user.name,
			        member.role, member.created_at AS createdAt
			 FROM member
			 INNER JOIN user ON user.id = member.user_id
			 WHERE member.space_slug = ?
			 ORDER BY user.email ASC`
		)
		.all(slug) as MemberListRow[];
}

export function upsertMember(
	userId: string,
	slug: string,
	role: SpaceRole,
	actorId: string | null
): void {
	const db = getAuthDb();
	const existing = db
		.query('SELECT id FROM member WHERE user_id = ? AND space_slug = ?')
		.get(userId, slug) as { id: string } | undefined;
	const now = Date.now();
	if (existing) {
		db.run('UPDATE member SET role = ? WHERE id = ?', [role, existing.id]);
	} else {
		db.run(
			'INSERT INTO member (id, user_id, space_slug, role, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)',
			[crypto.randomUUID(), userId, slug, role, now, actorId]
		);
	}
}

export function removeMember(userId: string, slug: string): void {
	getAuthDb().run('DELETE FROM member WHERE user_id = ? AND space_slug = ?', [userId, slug]);
}

/**
 * Promote the user with this email to install-admin — but only if no install
 * admin exists yet. Returns true if this call did the promotion, false if an
 * admin already existed (the caller lost a setup race and should roll back the
 * account it just created). The `NOT EXISTS` clause makes the check-and-set
 * atomic in one synchronous statement; migration 0004's partial unique index
 * is the structural backstop behind it.
 */
export function markInstallAdmin(email: string): boolean {
	const result = getAuthDb().run(
		`UPDATE user SET isInstallAdmin = 1
		 WHERE email = ? AND NOT EXISTS (SELECT 1 FROM user WHERE isInstallAdmin = 1)`,
		[email]
	);
	return result.changes === 1;
}

/**
 * Hard-delete a user and the better-auth rows that hang off it (sessions,
 * accounts), in one transaction. Used to roll back the account created by the
 * losing request in a setup race (see `markInstallAdmin`): that request made a
 * real, credentialed account before discovering another admin had already
 * claimed the install, and leaving it behind would be a silent stranger login
 * that also locks out future sign-ups (adminCount counts all users).
 */
export function deleteUserCascade(userId: string): void {
	const db = getAuthDb();
	db.transaction(() => {
		db.run('DELETE FROM session WHERE userId = ?', [userId]);
		db.run('DELETE FROM account WHERE userId = ?', [userId]);
		db.run('DELETE FROM user WHERE id = ?', [userId]);
	})();
}

export function resolveAccess(event: RequestEvent, slug: string): ResolvedAccess {
	const user = event.locals.user;
	if (!user) return { kind: 'none' };
	if (user.isInstallAdmin) return { kind: 'install-admin' };
	const role = getRole(user.id, slug);
	if (role) return { kind: 'member', role };
	return { kind: 'none' };
}

export function requireSpaceAccess(
	event: RequestEvent,
	slug: string,
	minimumRole?: SpaceRole
): void {
	const user = event.locals.user;
	if (!user) error(401, 'Unauthorized — the Amber admin requires authentication.');

	const access = resolveAccess(event, slug);

	if (access.kind === 'install-admin') {
		event.locals.access = access;
		event.locals.role = 'install-admin';
		return;
	}

	if (access.kind === 'none') {
		// Spec §3 disclosure choice: merge "unknown slug" and "not a member" into
		// a single 404 so non-members can't probe for slug existence.
		error(404, `no space with slug "${slug}"`);
	}

	// kind === 'member'
	if (minimumRole === 'owner' && access.role !== 'owner') {
		error(403, `You need owner access on "${slug}" for this action.`);
	}

	event.locals.access = access;
	event.locals.role = access.role;
}

export function canEdit(event: RequestEvent, slug: string): boolean {
	const user = event.locals.user;
	if (!user) return false;
	if (user.isInstallAdmin) return true;
	return getRole(user.id, slug) !== null;
}

export function canRead(event: RequestEvent, slug: string): boolean {
	// Read currently means "can reach the editor surface" — which is the same
	// set as `canEdit`. Kept as a distinct probe so a future read-only role can
	// land without rewiring every call site.
	return canEdit(event, slug);
}
