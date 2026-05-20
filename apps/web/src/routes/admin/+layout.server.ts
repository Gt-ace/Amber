/**
 * Top-level admin layout load (spec §2).
 *
 * Carries no auth guard — the route groups split authentication posture:
 *
 *   - `(public)/login`, `(public)/setup` — no session required.
 *   - `(authed)/*` — guarded by `(authed)/+layout.server.ts`.
 *
 * The admin chrome (`/admin/+layout.svelte`) wraps both groups; this load
 * supplies whatever the chrome needs to decide what to render (currently
 * just whether to show the "Sign out" affordance).
 */

import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	return { authed: event.locals.user != null };
};
