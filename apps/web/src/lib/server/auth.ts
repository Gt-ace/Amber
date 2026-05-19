/**
 * Auth seam for the /admin authoring surface (spec §8).
 *
 * Subsystem 2 (`better-auth`) will fill in the real session check; only the
 * SEAM is built here. Interim: an `AMBER_DEV_UNSAFE=1` env flag bypasses the
 * guard so subsystem 1 can be built, run, and tested end to end before auth
 * lands. Unset (the default) → access is denied. The flag is NEVER for
 * production; the app logs a loud warning at boot when it is set.
 *
 * Server-only by location (`lib/server/`). Subsystem 2 removes the interim
 * branch — the call sites do not change, only this module's internals.
 */

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';

const log = logger.child({ subsystem: 'auth' });

function devUnsafe(): boolean {
	return process.env.AMBER_DEV_UNSAFE === '1';
}

// Boot-time loud warning. Runs once when this module is first imported.
if (devUnsafe()) {
	log.warn(
		'AMBER_DEV_UNSAFE=1 — the /admin auth guard is BYPASSED. This is a ' +
			'development-only flag and must NEVER be set in production. ' +
			'Subsystem 2 (better-auth) removes this branch.'
	);
}

/**
 * Non-throwing probe: true when the request is from an authenticated author.
 * Used by the public render path to decide whether to emit the inline
 * "Edit this page" link. Interim behavior is gated entirely by AMBER_DEV_UNSAFE.
 */
export function isAuthor(_event: RequestEvent): boolean {
	return devUnsafe();
}

/**
 * Enforcing guard: returns normally when the request is authenticated, throws
 * a 401 otherwise. Call from every /admin/* server load and from the PUT save
 * endpoint (endpoints are not covered by layout loads). No login route exists
 * until subsystem 2, so an unauthenticated request is denied outright.
 */
export function requireAuthor(event: RequestEvent): void {
	if (isAuthor(event)) return;
	error(401, 'Unauthorized — the Amber admin requires authentication.');
}
