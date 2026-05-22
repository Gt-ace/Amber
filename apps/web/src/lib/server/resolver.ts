/**
 * Pure resolver — maps (host, pathname, search) to a routing decision against
 * a precomputed `ResolverIndex`. No I/O. See spec §3 for the algorithm and
 * §12.1 for why this is the first piece built.
 *
 * The index is built once at boot from the loaded space registry (see
 * `resolver-index.ts`). At request time we just look things up.
 *
 * Generic over the space type so the unit tests can pass a `FakeSpace` and
 * production passes a real `Space`. The resolver does not depend on any
 * `Space` member; it only carries the value through.
 */

// Admin and auth endpoints are host-locked to AMBER_PUBLIC_URL so better-auth's
// session cookie + OAuth callback round-trip on one host (spec §3 step 1).
const ADMIN_PATH_RE = /^\/admin(?:\/|$)/;
const AUTH_PATH_RE = /^\/api\/auth(?:\/|$)/;

export interface ResolverIndex<S> {
	/** Host portion of `AMBER_PUBLIC_URL` — the only host where admin/auth lives. */
	adminHost: string;
	/** Exact-match host index. */
	byHost: Map<string, S>;
	/** Path prefixes, sorted **longest-first** at index-build time. */
	prefixes: Array<{ prefix: string; space: S }>;
	/** The `default = true` space, if any. */
	default: S | null;
}

export type ResolveResult<S> =
	| { kind: 'admin' }
	| { kind: 'admin-elsewhere'; redirectTo: string }
	| { kind: 'space'; space: S; mountPath: string }
	| { kind: 'not-found' };

export function resolve<S>(
	index: ResolverIndex<S>,
	host: string,
	pathname: string,
	search = ''
): ResolveResult<S> {
	const isAdminPath = ADMIN_PATH_RE.test(pathname) || AUTH_PATH_RE.test(pathname);

	if (isAdminPath) {
		if (host === index.adminHost) return { kind: 'admin' };
		return {
			kind: 'admin-elsewhere',
			redirectTo: `https://${index.adminHost}${pathname}${search}`
		};
	}

	const hostMatch = index.byHost.get(host);
	if (hostMatch) return { kind: 'space', space: hostMatch, mountPath: pathname };

	if (index.default == null && index.prefixes.length === 0) {
		return { kind: 'not-found' };
	}

	// Longest-first prefix match: `prefixes` is pre-sorted by the index builder.
	for (const { prefix, space } of index.prefixes) {
		if (pathname === prefix) return { kind: 'space', space, mountPath: '/' };
		if (pathname.startsWith(prefix + '/')) {
			const mount = pathname.slice(prefix.length);
			return { kind: 'space', space, mountPath: mount };
		}
	}

	if (index.default) {
		return { kind: 'space', space: index.default, mountPath: pathname };
	}
	return { kind: 'not-found' };
}
