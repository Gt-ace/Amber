/**
 * Tiny module-level state: the default-space slug, set once by
 * `hooks.server.ts` at boot. The v0.4-compat admin shims
 * (`/admin/edit/[...path]`, `/admin/new`, `/admin/api/page/[...path]`) read
 * it so they redirect to the space declared `default = true` in
 * `space.toml`, not whichever slug happens to sort first.
 *
 * Single-space mode: the one loaded space is the default. Multi-space mode
 * with no `default` declared anywhere: the first registered entry, matching
 * the prior behaviour of the shims.
 *
 * Mirrors `reroute-prefixes.ts` in shape — a setter the boot path calls and
 * a getter the consumers call. Avoids a circular import via the registry.
 */

import path from 'node:path';
import type { Space } from '$lib/space/space';
import type { ResolverIndex } from './resolver';

let defaultSlug: string | null = null;

export function setDefaultSlug(slug: string | null): void {
	defaultSlug = slug;
}

export function getDefaultSlug(): string | null {
	return defaultSlug;
}

/**
 * Re-derives the default-slug from a resolver index + registry-style entry
 * list. Used by hooks.server.ts at boot and addSpace() on hot-add — both
 * sites must agree on the fallback (first registered entry when no default
 * is declared, but only when entries are nonempty).
 */
export function computeDefaultSlug(
	index: ResolverIndex<Space>,
	entries: Array<{ path: string; space: Space }>
): string | null {
	if (entries.length === 0) return null;
	if (index.default) {
		for (const e of entries) {
			if (e.space === index.default) return path.basename(e.path);
		}
	}
	return path.basename(entries[0].path);
}
