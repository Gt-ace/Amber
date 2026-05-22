/**
 * Discovery tests against `apps/web/fixtures/multi-space-broken/`. The
 * fixture has one valid pair (good-a, good-b) where good-b duplicates
 * good-a's host, an invalid-slug directory, a non-space directory (no
 * amber.toml), and a host+prefix conflict.
 */

import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { discoverSpaces, isValidSlug } from './spaces-dir';

const FIXTURE = fileURLToPath(
	new URL('../../../fixtures/multi-space-broken/', import.meta.url)
);

describe('isValidSlug()', () => {
	test('accepts lowercase + digits + hyphens', () => {
		expect(isValidSlug('good-a')).toBe(true);
		expect(isValidSlug('a')).toBe(true);
		expect(isValidSlug('a1')).toBe(true);
		expect(isValidSlug('a-b-c')).toBe(true);
	});

	test('rejects uppercase, leading hyphen, empty, > 63 chars', () => {
		expect(isValidSlug('Bad-Slug')).toBe(false);
		expect(isValidSlug('-bad')).toBe(false);
		expect(isValidSlug('')).toBe(false);
		expect(isValidSlug('a'.repeat(64))).toBe(false);
	});

	test('accepts exactly 63 chars', () => {
		expect(isValidSlug('a'.repeat(63))).toBe(true);
	});
});

describe('discoverSpaces()', () => {
	test('lists every subdir with an amber.toml, emits invalid_slug for bad names', () => {
		const { entries, warnings } = discoverSpaces(FIXTURE);
		const slugs = entries.map((e) => e.slug).sort();
		expect(slugs).toEqual(['conflict-host-and-prefix', 'good-a', 'good-b']);
		expect(warnings.map((w) => w.code)).toContain('space_routing_invalid_slug');
		// no-amber-toml is silently skipped.
		expect(warnings.find((w) => w.message.includes('no-amber-toml'))).toBeUndefined();
	});
});
