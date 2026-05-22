/**
 * /admin/account — the only authenticated account-management surface
 * (spec §6).
 *
 * Capabilities:
 *
 *   - **Change password.** Calls better-auth's `changePassword` with
 *     `revokeOtherSessions: true` so other devices have to re-log-in.
 *   - **Link Google.** Posts to `/api/auth/link-social` with provider=google.
 *     The form action redirects the browser there so the OAuth dance can
 *     follow.
 *   - **Unlink Google.** Blocked if the user has no password set — without
 *     it, the unlink would lock them out. The one-admin invariant
 *     enforced in code.
 *
 * Sign-out is a separate POST to /api/auth/sign-out from the admin chrome.
 */

import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAuth, resolveGoogleEnv, getAuthDb } from '$lib/server/auth-config';
import { APIError } from 'better-auth/api';

interface AccountRow {
	providerId: string;
	password: string | null;
}

function listAccounts(userId: string): AccountRow[] {
	const db = getAuthDb();
	return db
		.query('SELECT providerId, password FROM account WHERE userId = ?1')
		.all(userId) as AccountRow[];
}

function hasPassword(userId: string): boolean {
	return listAccounts(userId).some((a) => a.providerId === 'credential' && a.password);
}

function googleLinked(userId: string): boolean {
	return listAccounts(userId).some((a) => a.providerId === 'google');
}

export const load: PageServerLoad = async (event) => {
	// (authed) layout guarantees user is non-null.
	const user = event.locals.user!;
	return {
		user,
		isInstallAdmin: user.isInstallAdmin,
		googleEnabled: resolveGoogleEnv() != null,
		googleLinked: googleLinked(user.id),
		hasPassword: hasPassword(user.id)
	};
};

export const actions: Actions = {
	changePassword: async (event) => {
		const form = await event.request.formData();
		const currentPassword = String(form.get('currentPassword') ?? '');
		const newPassword = String(form.get('newPassword') ?? '');

		if (!currentPassword || !newPassword) {
			return fail(400, {
				changePassword: { ok: false as const, error: 'Both fields are required.' }
			});
		}
		if (newPassword.length < 8) {
			return fail(400, {
				changePassword: {
					ok: false as const,
					error: 'New password must be at least 8 characters.'
				}
			});
		}

		const auth = await getAuth();
		try {
			await auth.api.changePassword({
				body: { currentPassword, newPassword, revokeOtherSessions: true },
				headers: event.request.headers
			});
		} catch (e) {
			if (e instanceof APIError) {
				const message =
					(e as APIError & { body?: { message?: string } }).body?.message ??
					'Could not change password.';
				return fail(400, { changePassword: { ok: false as const, error: message } });
			}
			throw e;
		}
		return { changePassword: { ok: true as const, error: null } };
	},

	unlinkGoogle: async (event) => {
		const user = event.locals.user!;
		if (!hasPassword(user.id)) {
			return fail(400, {
				unlinkGoogle: {
					ok: false as const,
					error: 'Set a password first — without one, unlinking Google would lock you out.'
				}
			});
		}
		const auth = await getAuth();
		try {
			await auth.api.unlinkAccount({
				body: { providerId: 'google' },
				headers: event.request.headers
			});
		} catch (e) {
			if (e instanceof APIError) {
				const message =
					(e as APIError & { body?: { message?: string } }).body?.message ??
					'Could not unlink Google.';
				return fail(400, { unlinkGoogle: { ok: false as const, error: message } });
			}
			throw e;
		}
		return { unlinkGoogle: { ok: true as const, error: null } };
	},

	linkGoogle: async () => {
		// better-auth's link-social endpoint expects the OAuth dance to start
		// via /api/auth/sign-in/social/google with the current session set; on
		// callback it links to the live user. A simple redirect does it.
		redirect(302, '/api/auth/sign-in/social/google?callbackURL=/admin/account');
	},

	deleteSelf: async (event) => {
		const user = event.locals.user;
		if (!user) error(401, 'Unauthorized.');
		const db = getAuthDb();
		const row = db.query('SELECT isInstallAdmin FROM user WHERE id = ?1').get(user.id) as
			| { isInstallAdmin: number }
			| undefined;
		if (row?.isInstallAdmin) {
			return fail(400, {
				deleteSelf: {
					ok: false as const,
					error:
						'The install-admin cannot self-delete. Use bin/grant-ownership.ts to hand the role over, then run a CLI to clear the install-admin flag.'
				}
			});
		}
		const form = await event.request.formData();
		const confirmEmail = String(form.get('confirmEmail') ?? '').trim();
		if (confirmEmail !== user.email) {
			return fail(400, {
				deleteSelf: { ok: false as const, error: 'Confirmation email does not match.' }
			});
		}
		db.transaction(() => {
			db.run('DELETE FROM member WHERE user_id = ?1', [user.id]);
			db.run('DELETE FROM session WHERE userId = ?1', [user.id]);
			db.run('DELETE FROM account WHERE userId = ?1', [user.id]);
			db.run('DELETE FROM user WHERE id = ?1', [user.id]);
		})();
		redirect(302, '/');
	}
};
