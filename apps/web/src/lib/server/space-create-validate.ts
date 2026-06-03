/**
 * Pure validator for the /admin/new-space form. No I/O, no registry
 * reads — the caller passes a `RegistrySnapshot` built from the live
 * registry just before the submit is processed. Returns either a
 * `valid` ValidatedCreateInput (passed to space-create.ts as-is) or a
 * list of field errors (re-rendered into the form).
 *
 * Per spec §6.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
const BARE_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;
const PREFIX_RE = /^\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+(?:\/[A-Za-z0-9._~!$&'()*+,;=:@%-]+)*$/;

const RESERVED_PREFIX_ROOTS = ['/admin', '/api', '/themes'];
const RESERVED_PREFIX_EXACT = ['/sitemap.xml', '/robots.txt', '/favicon.ico'];

function isReservedPrefix(p: string): boolean {
	for (const root of RESERVED_PREFIX_ROOTS) {
		if (p === root || p.startsWith(root + '/')) return true;
	}
	return RESERVED_PREFIX_EXACT.includes(p);
}

export type RoutingKind = 'host' | 'prefix' | 'default' | 'admin-only';

export interface RawCreateInput {
	title: string;
	slug: string;
	routingKind: RoutingKind;
	host: string;
	prefix: string;
}

export type Routing =
	| { kind: 'host'; host: string }
	| { kind: 'prefix'; prefix: string }
	| { kind: 'default' }
	| { kind: 'admin-only' };

export interface ValidatedCreateInput {
	slug: string;
	title: string;
	routing: Routing;
}

export type CreateErrorCode =
	| 'title_empty'
	| 'slug_invalid'
	| 'slug_taken'
	| 'host_invalid'
	| 'host_is_admin'
	| 'host_taken'
	| 'prefix_invalid'
	| 'prefix_reserved'
	| 'prefix_taken'
	| 'default_taken';

export type FieldName = 'title' | 'slug' | 'host' | 'prefix' | 'default';

export interface FieldError {
	field: FieldName;
	code: CreateErrorCode;
}

export interface ValidateResult {
	valid: ValidatedCreateInput | null;
	errors: FieldError[];
}

/**
 * A snapshot of the live registry's routing state. Built once per
 * submit by reading `getRegistryEntries()` and the resolver index;
 * passed in so the validator stays pure.
 */
export interface RegistrySnapshot {
	/** Slugs (directory names) currently on disk under AMBER_SPACES_DIR. */
	slugs: Set<string>;
	/** host → owner-slug for spaces already claiming a host. */
	hosts: Map<string, string>;
	/** prefix → owner-slug for spaces already claiming a prefix. */
	prefixes: Map<string, string>;
	/** The slug of the current default-space, or null. */
	defaultOwner: string | null;
	/** Host portion of AMBER_PUBLIC_URL — the admin host. */
	adminHost: string;
}

export function validateCreateInput(raw: RawCreateInput, snap: RegistrySnapshot): ValidateResult {
	const errors: FieldError[] = [];

	const title = raw.title.trim();
	if (title.length === 0) errors.push({ field: 'title', code: 'title_empty' });

	const slug = raw.slug.trim();
	if (!SLUG_RE.test(slug)) {
		errors.push({ field: 'slug', code: 'slug_invalid' });
	} else if (snap.slugs.has(slug)) {
		errors.push({ field: 'slug', code: 'slug_taken' });
	}

	let routing: Routing | null = null;
	switch (raw.routingKind) {
		case 'host': {
			const h = raw.host.trim();
			if (h.length === 0 || !BARE_HOST_RE.test(h) || h.includes(':') || h.includes('/')) {
				errors.push({ field: 'host', code: 'host_invalid' });
				break;
			}
			if (h === snap.adminHost) {
				errors.push({ field: 'host', code: 'host_is_admin' });
				break;
			}
			if (snap.hosts.has(h)) {
				errors.push({ field: 'host', code: 'host_taken' });
				break;
			}
			routing = { kind: 'host', host: h };
			break;
		}
		case 'prefix': {
			const p = raw.prefix.trim();
			if (
				!p.startsWith('/') ||
				p === '/' ||
				p.endsWith('/') ||
				p.includes('?') ||
				p.includes('#') ||
				!PREFIX_RE.test(p)
			) {
				errors.push({ field: 'prefix', code: 'prefix_invalid' });
				break;
			}
			if (isReservedPrefix(p)) {
				errors.push({ field: 'prefix', code: 'prefix_reserved' });
				break;
			}
			if (snap.prefixes.has(p)) {
				errors.push({ field: 'prefix', code: 'prefix_taken' });
				break;
			}
			routing = { kind: 'prefix', prefix: p };
			break;
		}
		case 'default': {
			if (snap.defaultOwner !== null) {
				errors.push({ field: 'default', code: 'default_taken' });
				break;
			}
			routing = { kind: 'default' };
			break;
		}
		case 'admin-only': {
			routing = { kind: 'admin-only' };
			break;
		}
	}

	// `routing === null` with no errors can only happen if `raw.routingKind`
	// arrives outside the `RoutingKind` union at runtime (tampered POST,
	// future refactor leaving a stale value). The route action narrows the
	// formData value to `RoutingKind` before calling us; this guard is
	// defense-in-depth so a slipped boundary surfaces as `valid: null`
	// rather than silently building a `Routing` from missing data.
	if (errors.length > 0 || routing === null) {
		return { valid: null, errors };
	}
	return { valid: { slug, title, routing }, errors: [] };
}
