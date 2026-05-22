// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces

import type { Logger } from '$lib/server/logger';

declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			log: Logger;
			/** Authenticated user, or null. Populated once per request by hooks.server.ts. */
			user: { id: string; email: string; name?: string | null } | null;
			/** Better-auth session row, or null. */
			session: { id: string; userId: string; expiresAt: Date } | null;
			/** Resolved space for the current request, or null on admin/auth paths. */
			space: import('$lib/space/space').Space | null;
			/** Pathname after stripping the space's mount prefix; null on admin/auth. */
			mountPath: string | null;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
