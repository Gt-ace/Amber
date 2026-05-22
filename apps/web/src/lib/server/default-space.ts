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

let defaultSlug: string | null = null;

export function setDefaultSlug(slug: string | null): void {
	defaultSlug = slug;
}

export function getDefaultSlug(): string | null {
	return defaultSlug;
}
