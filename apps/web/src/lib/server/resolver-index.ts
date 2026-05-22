/**
 * Builds the request-time `ResolverIndex` from a list of loaded spaces +
 * the admin host. Spec §4 cross-space conflict rules. First-loaded wins on
 * any duplicate; the loser's offending field is dropped (the *space* stays
 * in the registry — only its public route hook is removed).
 *
 * Pure function. The caller (`hooks.server.ts` at boot) is responsible for
 * loading spaces and reading their `space.toml` routing fields. This
 * function only sees the result.
 */

import type { Space } from '$lib/space/space';
import type { LoadWarning } from '$lib/types/schema';
import type { ResolverIndex } from './resolver';
import type { SpaceRouting } from './space-routing';

export interface LoadedSpace {
	/** Directory name; satisfies the slug regex by the time it reaches us. */
	slug: string;
	space: Space;
	routing: SpaceRouting;
}

export interface BuildResult {
	index: ResolverIndex<Space>;
	warnings: LoadWarning[];
}

export function buildResolverIndex(
	loaded: LoadedSpace[],
	adminHost: string,
	adminScheme: string = 'https:'
): BuildResult {
	const warnings: LoadWarning[] = [];
	const byHost = new Map<string, Space>();
	const hostOwner = new Map<string, string>();
	const prefixes: Array<{ prefix: string; space: Space }> = [];
	const prefixOwner = new Map<string, string>();
	let defaultSpace: Space | null = null;
	let defaultOwner: string | null = null;

	for (const entry of loaded) {
		const { slug, space, routing } = entry;
		const source = `${slug}/space.toml`;

		if (routing.host) {
			const existing = hostOwner.get(routing.host);
			if (existing) {
				warnings.push({
					code: 'space_routing_duplicate_host',
					message: `space \`${slug}\` declares host "${routing.host}" already claimed by space \`${existing}\`; the loser's host is dropped (the space is still reachable via admin slug \`${slug}\`)`,
					source
				});
			} else {
				byHost.set(routing.host, space);
				hostOwner.set(routing.host, slug);
			}
		}

		if (routing.prefix) {
			const existing = prefixOwner.get(routing.prefix);
			if (existing) {
				warnings.push({
					code: 'space_routing_duplicate_prefix',
					message: `space \`${slug}\` declares prefix "${routing.prefix}" already claimed by space \`${existing}\`; the loser's prefix is dropped`,
					source
				});
			} else {
				prefixes.push({ prefix: routing.prefix, space });
				prefixOwner.set(routing.prefix, slug);
			}
		}

		if (routing.default) {
			if (defaultSpace) {
				warnings.push({
					code: 'space_routing_duplicate_default',
					message: `space \`${slug}\` declares \`default = true\` but space \`${defaultOwner}\` already won; \`default\` flag dropped`,
					source
				});
			} else {
				defaultSpace = space;
				defaultOwner = slug;
			}
		}
	}

	// Longest-first ensures /scratch-archive/x doesn't match a /scratch prefix.
	prefixes.sort((a, b) => b.prefix.length - a.prefix.length);

	return {
		index: { adminHost, adminScheme, byHost, prefixes, default: defaultSpace },
		warnings
	};
}
