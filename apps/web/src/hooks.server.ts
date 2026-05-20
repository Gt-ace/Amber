/**
 * Server hooks (spec §4, §6).
 *
 * Three responsibilities per request:
 *
 *   1. Initialize the Space singleton at startup so a misconfigured
 *      AMBER_SPACE_PATH (or unreadable space) fails the boot, not the first
 *      request. Initialize the auth singleton (and run better-auth's
 *      migrations) for the same reason.
 *   2. Resolve the session cookie once and populate `event.locals.user` /
 *      `event.locals.session`. The /admin chrome and the public render
 *      path's `isAuthor()` probe both read these — one resolution per
 *      request, not per call site.
 *   3. Route /api/auth/* through better-auth's handler. We delegate to
 *      `svelteKitHandler`, which calls our `resolve(event)` for everything
 *      that isn't an auth endpoint.
 *
 * Also emits a request_id + start/end log line for every request (unchanged
 * from before this subsystem).
 */

import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { logger } from '$lib/server/logger';
import { getSpace } from '$lib/server/space';
import { getAuth } from '$lib/server/auth-config';

getSpace();

// Build the auth instance and run better-auth's migrations on first request.
// Doing this lazily (rather than via top-level `await`) avoids a Vite chunk
// ordering issue: with top-level await, the auth-config chunk re-enters
// itself through better-auth's dynamic import of the SQLite dialect before
// the chunk's own exports are bound, producing an `undefined is not a
// constructor` runtime error against `BunSqliteDialect`. Single-flight
// guard so concurrent first-requests share one migration run.
let authPromise: Promise<Awaited<ReturnType<typeof getAuth>>> | null = null;
function auth() {
	if (!authPromise) authPromise = getAuth();
	return authPromise;
}

function newRequestId(): string {
	return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

export const handle: Handle = async ({ event, resolve }) => {
	const request_id = newRequestId();
	const log = logger.child({ request_id });
	event.locals.log = log;
	event.locals.user = null;
	event.locals.session = null;

	const method = event.request.method;
	const path = event.url.pathname;
	const start = performance.now();

	log.info({ method, path }, 'request start');

	let status = 500;
	try {
		try {
			const result = await (await auth()).api.getSession({ headers: event.request.headers });
			if (result?.user) {
				event.locals.user = {
					id: result.user.id,
					email: result.user.email,
					name: result.user.name
				};
				event.locals.session = {
					id: result.session.id,
					userId: result.session.userId,
					expiresAt: new Date(result.session.expiresAt)
				};
			}
		} catch (e) {
			// A bad/expired cookie just means "no session"; the better-auth
			// handler will clean up downstream.
			log.debug({ err: (e as Error)?.message }, 'session resolve failed');
		}

		const response = await svelteKitHandler({ auth: await auth(), event, resolve, building });
		status = response.status;
		return response;
	} finally {
		const duration_ms = Math.round(performance.now() - start);
		log.info({ method, path, status, duration_ms }, 'request end');
	}
};
