/**
 * /admin/users — install-admin-only user list (spec §2).
 *
 * Lists every user with last-sign-in (max session.createdAt) and a
 * membership count. The "Delete user" action lives here too (Task 21).
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAuthDb } from '$lib/server/auth-config';

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
