/**
 * Per-space routing-field validation (spec §4). Pure function over a parsed
 * `SpaceConfig` plus the slug (for the warning's `source` field) and the
 * admin host (to flag the admin-host collision). Cross-space conflicts
 * (duplicate host / duplicate prefix / duplicate default) live in
 * `resolver-index.ts` because they need the full set.
 *
 * Each rule produces a single warning code from the v0.5 subsystem 3
 * additions in `lib/types/schema.ts`.
 */

import type { LoadWarning } from '$lib/types/schema';
import type { SpaceConfig } from '$lib/space/config';

export interface SpaceRouting {
	host: string | null;
	prefix: string | null;
	default: boolean;
}

export interface ParseSpaceRoutingResult {
	routing: SpaceRouting;
	warnings: LoadWarning[];
}

const BARE_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const PREFIX_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*$/;

export function parseSpaceRouting(
	config: SpaceConfig,
	slug: string,
	adminHost: string
): ParseSpaceRoutingResult {
	const source = `${slug}/space.toml`;
	const warnings: LoadWarning[] = [];
	let host: string | null = null;
	let prefix: string | null = null;
	const isDefault = config.default === true;

	const hasHost = typeof config.host === 'string' && config.host.length > 0;
	const hasPrefix = typeof config.prefix === 'string' && config.prefix.length > 0;

	if (hasHost && hasPrefix) {
		warnings.push({
			code: 'space_routing_conflict',
			message: `space.toml declares both \`host\` and \`prefix\`; both dropped (the space is reachable only via admin slug \`${slug}\`)`,
			source
		});
		return { routing: { host: null, prefix: null, default: isDefault }, warnings };
	}

	if (hasHost) {
		const h = (config.host as string).trim();
		if (!BARE_HOST_RE.test(h)) {
			warnings.push({
				code: 'space_routing_invalid_host',
				message: `space.toml \`host\` must be a bare host string (no scheme, port, path, or wildcard); got "${h}"`,
				source
			});
		} else if (h === adminHost) {
			warnings.push({
				code: 'space_routing_admin_host_collision',
				message: `space.toml \`host = "${h}"\` collides with the admin host derived from AMBER_PUBLIC_URL; the admin/auth short-circuit always wins on that host. \`host\` dropped.`,
				source
			});
		} else {
			host = h;
		}
	}

	if (hasPrefix) {
		const p = config.prefix as string;
		if (
			!p.startsWith('/') ||
			p === '/' ||
			p.endsWith('/') ||
			p.includes('?') ||
			p.includes('#') ||
			!PREFIX_RE.test(p)
		) {
			warnings.push({
				code: 'space_routing_invalid_prefix',
				message: `space.toml \`prefix\` must be a clean leading-slash path with no trailing slash, query, or fragment; got "${p}"`,
				source
			});
		} else {
			prefix = p;
		}
	}

	if (host === null && prefix === null && !isDefault) {
		warnings.push({
			code: 'space_routing_unreachable',
			message: `space \`${slug}\` has no \`host\`, no \`prefix\`, and is not \`default\`; it is loaded and listed in the admin picker but will never serve a public request`,
			source
		});
	}

	return { routing: { host, prefix, default: isDefault }, warnings };
}
