/**
 * Tiny module-level state: the boot-time resolver index, set once by
 * `hooks.server.ts` at boot and (after v0.5 subsystem 5) replaced by
 * `addSpace()` when a new space is created through the admin UI.
 *
 * Mirrors `reroute-prefixes.ts` and `default-space.ts` in shape — a
 * setter the boot path (and `addSpace`) call, a getter the request
 * handler calls. Splitting this out of `hooks.server.ts` makes the
 * resolver index mutable without exporting state from a hooks module.
 */

import type { Space } from '$lib/space/space';
import type { ResolverIndex } from './resolver';

let current: ResolverIndex<Space> | null = null;

export function setResolverIndex(index: ResolverIndex<Space>): void {
	current = index;
}

export function getResolverIndex(): ResolverIndex<Space> {
	if (current === null) {
		throw new Error(
			'resolver index not initialised — hooks.server.ts must call setResolverIndex() at boot before any request handler runs'
		);
	}
	return current;
}

/**
 * Test-only reset. Lets test setup wipe the index between cases without
 * needing to rebuild it. Production never calls this.
 */
export function __resetResolverIndexForTests(): void {
	current = null;
}
