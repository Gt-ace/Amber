/**
 * /admin/login — the email+password sign-in form, plus a "Continue with
 * Google" button when Google OAuth is configured (spec §2, §4).
 *
 * The load redirects to /admin/setup if no admin exists yet (the first-run
 * bootstrap path). The action calls better-auth's `signInEmail` server-side;
 * the `sveltekitCookies` plugin in `auth-config.ts` mirrors the session
 * cookie onto the SvelteKit response, so on success we just redirect to the
 * validated `?next=` or `/admin`.
 *
 * Wrong-password error: surfaced inline. better-auth returns a single
 * "Invalid email or password" code; we don't distinguish so the single-admin
 * shape doesn't leak whether the email exists (spec §4).
 */

import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAuth, resolveGoogleEnv } from '$lib/server/auth-config';
import { adminCount } from '$lib/server/auth-queries';
import { validateNext } from '$lib/server/next-validator';
import { APIError } from 'better-auth/api';

export const load: PageServerLoad = async (event) => {
	if (event.locals.user) {
		redirect(302, validateNext(event.url.searchParams.get('next')));
	}
	if ((await adminCount()) === 0) {
		redirect(302, '/admin/setup');
	}
	const rawNext = event.url.searchParams.get('next');
	return {
		googleEnabled: resolveGoogleEnv() != null,
		next: rawNext == null ? null : validateNext(rawNext)
	};
};

export const actions: Actions = {
	default: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const next = validateNext(String(form.get('next') ?? '') || null);

		if (!email || !password) {
			return fail(400, { email, error: 'Email and password are required.' });
		}

		const auth = await getAuth();
		try {
			await auth.api.signInEmail({
				body: { email, password },
				headers: event.request.headers
			});
		} catch (e) {
			if (e instanceof APIError) {
				return fail(401, { email, error: 'Invalid email or password.' });
			}
			throw e;
		}
		redirect(302, next);
	}
};
