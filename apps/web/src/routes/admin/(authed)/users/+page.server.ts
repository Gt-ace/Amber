/**
 * /admin/users — install-admin-only user list (spec §2).
 *
 * Lists every user with last-sign-in (max session.createdAt) and a
 * membership count. The "Delete user" action lives here too (Task 21).
 */

import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAuthDb } from '$lib/server/auth-config';
import { logger } from '$lib/server/logger';

const log = logger.child({ subsystem: 'permissions' });

interface UserRow {
	id: string;
	email: string;
	name: string | null;
	isInstallAdmin: number;
	lastSignIn: number | null;
	memberships: number;
}

export const load: PageServerLoad = async (event) => {
	if (!event.locals.user) error(401, 'Unauthorized.');
	if (!event.locals.user.isInstallAdmin) error(403, 'Install-admin only.');

	const db = getAuthDb();
	const rows = db
		.query(
			`SELECT u.id, u.email, u.name, u.isInstallAdmin,
			        (SELECT MAX(createdAt) FROM session WHERE userId = u.id) AS lastSignIn,
			        (SELECT COUNT(*) FROM member WHERE user_id = u.id) AS memberships
			 FROM user u
			 ORDER BY u.isInstallAdmin DESC, u.email ASC`
		)
		.all() as UserRow[];

	return {
		users: rows.map((r) => ({
			id: r.id,
			email: r.email,
			name: r.name,
			isInstallAdmin: !!r.isInstallAdmin,
			lastSignIn: r.lastSignIn,
			memberships: r.memberships
		}))
	};
};

export const actions: Actions = {
	deleteUser: async (event) => {
		if (!event.locals.user?.isInstallAdmin) error(403, 'Install-admin only.');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const confirmEmail = String(form.get('confirmEmail') ?? '').trim();
		if (!userId) return fail(400, { delete: { ok: false as const, error: 'Missing user id.' } });

		const db = getAuthDb();
		const target = db
			.query('SELECT id, email, isInstallAdmin FROM user WHERE id = ?1')
			.get(userId) as { id: string; email: string; isInstallAdmin: number } | undefined;
		if (!target) return fail(404, { delete: { ok: false as const, error: 'Unknown user.' } });
		if (target.isInstallAdmin) {
			return fail(400, {
				delete: {
					ok: false as const,
					error: 'The install-admin cannot be deleted through the UI. Use the CLI escape hatch.'
				}
			});
		}
		if (confirmEmail !== target.email) {
			return fail(400, {
				delete: { ok: false as const, error: 'Confirmation email does not match.' }
			});
		}

		db.transaction(() => {
			db.run('DELETE FROM member WHERE user_id = ?1', [userId]);
			db.run('DELETE FROM session WHERE userId = ?1', [userId]);
			db.run('DELETE FROM account WHERE userId = ?1', [userId]);
			db.run('DELETE FROM user WHERE id = ?1', [userId]);
		})();

		log.info({ code: 'user_deleted', actorId: event.locals.user.id, userId }, 'user deleted');
		return { delete: { ok: true as const } };
	}
};
