/**
 * Module-scoped AsyncLocalStorage that carries a pending invite-id through
 * the call stack of a redemption action. The user-create hook in
 * `auth-config.ts` reads from this store to decide whether to allow a
 * sign-up that would otherwise be rejected by the single-admin rule
 * (spec §4, §6).
 *
 * Kept in its own module so the redemption route and the hook can both
 * import it without dragging the rest of `auth-config.ts` into either
 * direction's dependency graph.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export interface InviteContext {
	pendingInviteId: string;
}

export const inviteContext = new AsyncLocalStorage<InviteContext>();
