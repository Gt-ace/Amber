/**
 * /admin/setup — the first-run claim screen (spec §3).
 *
 * Load: 404 once any admin exists; otherwise render the form.
 * Action: re-check the admin count, then call `auth.api.signUpEmail` to
 * create the user and issue a session in one step. The user-create hook in
 * `auth-config.ts` is the final gate; SQLite single-writer serialization
 * keeps the race window tight.
 *
 * Google bootstrap path: the "Continue with Google" button hits
 * /api/auth/sign-in/social/google directly. better-auth's social flow lands
 * back in the user-create hook on first sign-in; with zero admins, the hook
 * allows it. Once one admin exists, the same hook rejects any further
 * stranger sign-ins (spec §5).
 */

import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAuth, resolveGoogleEnv } from '$lib/server/auth-config';
import { adminCount } from '$lib/server/auth-queries';
import { APIError } from 'better-auth/api';

export const load: PageServerLoad = async () => {
	if ((await adminCount()) >= 1) {
		error(404, 'Setup is already complete.');
	}
	return { googleEnabled: resolveGoogleEnv() != null };
};

export const actions: Actions = {
	default: async (event) => {
		if ((await adminCount()) >= 1) {
			return fail(409, {
				email: '',
				name: '',
				error: 'Setup is already complete. Sign in instead.'
			});
		}

		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const name = String(form.get('name') ?? '').trim() || email.split('@')[0] || 'admin';

		if (!email || !password) {
			return fail(400, { email, name, error: 'Email and password are required.' });
		}
		if (password.length < 8) {
			return fail(400, { email, name, error: 'Password must be at least 8 characters.' });
		}

		const auth = await getAuth();
		try {
			await auth.api.signUpEmail({
				body: { email, password, name },
				headers: event.request.headers
			});
		} catch (e) {
			if (e instanceof APIError) {
				const message =
					(e as APIError & { body?: { message?: string } }).body?.message ?? e.message;
				return fail(400, { email, name, error: message });
			}
			throw e;
		}
		redirect(302, '/admin');
	}
};
