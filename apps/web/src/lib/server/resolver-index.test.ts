/**
 * `buildResolverIndex()` is the cross-space conflict resolver. It takes the
 * loaded spaces (with their parsed routing fields) + the admin host and
 * collapses them into a `ResolverIndex<Space>` that the request-time
 * resolver consumes.
 *
 * Spec §4 cross-space rules: duplicate_host / duplicate_prefix /
 * duplicate_default → first-loaded wins, loser dropped with a warning.
 * Prefixes sorted longest-first.
 */

import { describe, expect, test } from 'vitest';
import { buildResolverIndex, type LoadedSpace } from './resolver-index';

const ADMIN = 'admin.example.com';

function loaded(
	slug: string,
	routing: Partial<{ host: string | null; prefix: string | null; default: boolean }> = {}
): LoadedSpace {
	return {
		slug,
		space: { id: slug } as never,
		routing: {
			host: routing.host ?? null,
			prefix: routing.prefix ?? null,
			default: routing.default ?? false
		}
	};
}

describe('buildResolverIndex()', () => {
	test('single host space → indexed by host, no default', () => {
		const { index, warnings } = buildResolverIndex([loaded('a', { host: 'a.example.com' })], ADMIN);
		expect(index.byHost.get('a.example.com')).toBeDefined();
		expect(index.default).toBeNull();
		expect(warnings).toEqual([]);
	});

	test('duplicate host → first-loaded wins, loser warned', () => {
		const { index, warnings } = buildResolverIndex(
			[loaded('a', { host: 'x.example.com' }), loaded('b', { host: 'x.example.com' })],
			ADMIN
		);
		expect((index.byHost.get('x.example.com') as unknown as { id: string }).id).toBe('a');
		expect(warnings.map((w) => w.code)).toContain('space_routing_duplicate_host');
		expect(warnings.find((w) => w.code === 'space_routing_duplicate_host')?.source).toContain('b');
	});

	test('duplicate prefix → first-loaded wins', () => {
		const { index, warnings } = buildResolverIndex(
			[loaded('a', { prefix: '/x' }), loaded('b', { prefix: '/x' })],
			ADMIN
		);
		expect(index.prefixes).toHaveLength(1);
		expect((index.prefixes[0].space as unknown as { id: string }).id).toBe('a');
		expect(warnings.map((w) => w.code)).toContain('space_routing_duplicate_prefix');
	});

	test('duplicate default → first-loaded wins', () => {
		const { index, warnings } = buildResolverIndex(
			[loaded('a', { default: true }), loaded('b', { default: true })],
			ADMIN
		);
		expect((index.default as unknown as { id: string }).id).toBe('a');
		expect(warnings.map((w) => w.code)).toContain('space_routing_duplicate_default');
	});

	test('prefixes sorted longest-first', () => {
		const { index } = buildResolverIndex(
			[
				loaded('short', { prefix: '/s' }),
				loaded('long', { prefix: '/scratch-archive' }),
				loaded('mid', { prefix: '/scratch' })
			],
			ADMIN
		);
		expect(index.prefixes.map((p) => p.prefix)).toEqual(['/scratch-archive', '/scratch', '/s']);
	});

	test('adminHost is the one passed in', () => {
		const { index } = buildResolverIndex([], 'foo.example.com');
		expect(index.adminHost).toBe('foo.example.com');
	});

	test('mixed: one host, one prefix, one default, all valid → all indexed', () => {
		const { index, warnings } = buildResolverIndex(
			[
				loaded('host-space', { host: 'h.example.com' }),
				loaded('prefix-space', { prefix: '/p' }),
				loaded('def-space', { default: true })
			],
			ADMIN
		);
		expect(index.byHost.size).toBe(1);
		expect(index.prefixes).toHaveLength(1);
		expect(index.default).not.toBeNull();
		expect(warnings).toEqual([]);
	});
});
