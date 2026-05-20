/**
 * Validates a `?next=` redirect parameter as a same-origin path (spec §4).
 *
 * Accepts only relative paths beginning with a single `/`. Protocol-relative
 * (`//evil.example.com`), absolute (`https://...`), and pseudo-scheme
 * (`javascript:`, `data:`) values are rejected. The value is URI-decoded once
 * before checking, so an attacker can't smuggle a scheme through `%2F%2F`.
 *
 * Returns the validated path or the supplied fallback (default `/admin`).
 */
export function validateNext(raw: string | null | undefined, fallback = '/admin'): string {
	if (raw == null || raw === '') return fallback;
	let decoded: string;
	try {
		decoded = decodeURIComponent(raw);
	} catch {
		return fallback;
	}
	if (!decoded.startsWith('/')) return fallback;
	if (decoded.startsWith('//')) return fallback;
	if (decoded.startsWith('/\\')) return fallback;
	if (/^\/[^/]*:/.test(decoded)) return fallback;
	return decoded;
}
