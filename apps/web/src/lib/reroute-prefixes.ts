/**
 * Tiny module-level state: the active prefix list, set once by
 * `hooks.server.ts` at boot. `hooks.ts` (`reroute`) reads it. This split
 * exists because `reroute` runs in universal contexts and must not import
 * the full server-side resolver index.
 */

let prefixes: string[] = [];

export function setReroutePrefixes(list: string[]): void {
	// Stored longest-first so the reroute matcher behaves the same as the
	// resolver's match loop.
	prefixes = [...list].sort((a, b) => b.length - a.length);
}

export function reroutePrefixes(): string[] {
	return prefixes;
}
