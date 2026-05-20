/**
 * Auth seam for the /admin authoring surface (spec §6).
 *
 * Subsystem 2 fills in the real session check. The signatures here are
 * unchanged from subsystem 1 — every call site (admin layout guard, PUT save
 * endpoint, the public render path's "Edit this page" probe) keeps working
 * as before; only this module's internals changed.
 *
 * `event.locals.user` is populated once per request by `hooks.server.ts`
 * from better-auth's session resolution. Both functions are pure reads of
 * that value, so the public render path stays a single DB hit per request
 * regardless of how many `isAuthor()` calls a render makes.
 */

import { error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';

/**
 * Non-throwing probe: true when the request is from an authenticated author.
 * Used by the public render path to decide whether to emit the inline
 * "Edit this page" link.
 */
export function isAuthor(event: RequestEvent): boolean {
	return event.locals.user != null;
}

/**
 * Enforcing guard: returns normally when authenticated, throws a 401
 * otherwise. The `(authed)` layout wraps this throw with a redirect to
 * `/admin/login`; endpoints (the PUT save handler) let the 401 propagate.
 */
export function requireAuthor(event: RequestEvent): void {
	if (isAuthor(event)) return;
	error(401, 'Unauthorized — the Amber admin requires authentication.');
}
