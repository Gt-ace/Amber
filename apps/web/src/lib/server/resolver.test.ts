/**
 * Pure resolver tests. No filesystem, no real Space — the resolver is a
 * pure function over a synthetic ResolverIndex. See spec §3 for the
 * algorithm and §9 for the test matrix.
 */

import { describe, expect, test } from 'vitest';
import { resolve, type ResolverIndex } from './resolver';

/** Stand-in for a real `Space`; the resolver only reads identity. */
type FakeSpace = { id: string };

function index(overrides: Partial<ResolverIndex<FakeSpace>> = {}): ResolverIndex<FakeSpace> {
	return {
		adminHost: 'admin.example.com',
		adminScheme: 'https:',
		byHost: new Map(),
		prefixes: [],
		default: null,
		...overrides
	};
}

describe('resolve()', () => {
	test('admin path on admin host → kind: admin', () => {
		const r = resolve(index(), 'admin.example.com', '/admin');
		expect(r.kind).toBe('admin');
	});

	test('/api/auth/* on admin host → kind: admin', () => {
		const r = resolve(index(), 'admin.example.com', '/api/auth/sign-in');
		expect(r.kind).toBe('admin');
	});

	test('/admin on the wrong host → admin-elsewhere with redirect', () => {
		const r = resolve(index(), 'amber.example.com', '/admin/login');
		expect(r.kind).toBe('admin-elsewhere');
		if (r.kind !== 'admin-elsewhere') throw new Error('unreachable');
		expect(r.redirectTo).toBe('https://admin.example.com/admin/login');
	});

	test('host match wins over default', () => {
		const a: FakeSpace = { id: 'a' };
		const d: FakeSpace = { id: 'd' };
		const r = resolve(
			index({ byHost: new Map([['amber.example.com', a]]), default: d }),
			'amber.example.com',
			'/about'
		);
		expect(r.kind).toBe('space');
		if (r.kind !== 'space') throw new Error('unreachable');
		expect(r.space.id).toBe('a');
		expect(r.mountPath).toBe('/about');
		expect(r.mountPrefix).toBe('');
	});

	test('prefix match (longest-first) on default host', () => {
		const a: FakeSpace = { id: 'scratch' };
		const b: FakeSpace = { id: 'scratch-archive' };
		const d: FakeSpace = { id: 'default' };
		const idx = index({
			default: d,
			prefixes: [
				{ prefix: '/scratch-archive', space: b },
				{ prefix: '/scratch', space: a }
			]
		});
		const r = resolve(idx, 'example.com', '/scratch-archive/post-1');
		expect(r.kind).toBe('space');
		if (r.kind !== 'space') throw new Error('unreachable');
		expect(r.space.id).toBe('scratch-archive');
		expect(r.mountPath).toBe('/post-1');
		expect(r.mountPrefix).toBe('/scratch-archive');
	});

	test('prefix exact match strips to /', () => {
		const a: FakeSpace = { id: 'scratch' };
		const d: FakeSpace = { id: 'default' };
		const r = resolve(
			index({ default: d, prefixes: [{ prefix: '/scratch', space: a }] }),
			'example.com',
			'/scratch'
		);
		expect(r.kind).toBe('space');
		if (r.kind !== 'space') throw new Error('unreachable');
		expect(r.space.id).toBe('scratch');
		expect(r.mountPath).toBe('/');
		expect(r.mountPrefix).toBe('/scratch');
	});

	test('default-space match exposes empty mountPrefix', () => {
		const d: FakeSpace = { id: 'default' };
		const r = resolve(index({ default: d }), 'random.example.com', '/foo');
		expect(r.kind).toBe('space');
		if (r.kind !== 'space') throw new Error('unreachable');
		expect(r.mountPrefix).toBe('');
	});

	test('unclaimed host + no default → not-found', () => {
		const r = resolve(index(), 'random.example.com', '/whatever');
		expect(r.kind).toBe('not-found');
	});

	test('unclaimed host + default → default serves it', () => {
		const d: FakeSpace = { id: 'default' };
		const r = resolve(index({ default: d }), 'random.example.com', '/foo');
		expect(r.kind).toBe('space');
		if (r.kind !== 'space') throw new Error('unreachable');
		expect(r.space.id).toBe('default');
		expect(r.mountPath).toBe('/foo');
	});

	test('prefix does not match across a non-/-boundary', () => {
		// /scratchy/x must NOT match a "/scratch" prefix space.
		const a: FakeSpace = { id: 'scratch' };
		const d: FakeSpace = { id: 'default' };
		const r = resolve(
			index({ default: d, prefixes: [{ prefix: '/scratch', space: a }] }),
			'example.com',
			'/scratchy/x'
		);
		expect(r.kind).toBe('space');
		if (r.kind !== 'space') throw new Error('unreachable');
		expect(r.space.id).toBe('default');
	});

	test('admin-elsewhere preserves query string', () => {
		const r = resolve(
			index(),
			'amber.example.com',
			'/admin/login',
			'?next=%2Fadmin%2Faccount'
		);
		expect(r.kind).toBe('admin-elsewhere');
		if (r.kind !== 'admin-elsewhere') throw new Error('unreachable');
		expect(r.redirectTo).toBe(
			'https://admin.example.com/admin/login?next=%2Fadmin%2Faccount'
		);
	});

	test('single-space-mode degenerate index: default-only, non-admin paths fall through to lone space', () => {
		const d: FakeSpace = { id: 'only' };
		const idx = index({ default: d });
		for (const host of ['admin.example.com', 'random.example.com', '127.0.0.1']) {
			const r = resolve(idx, host, '/foo');
			expect(r.kind).toBe('space');
			if (r.kind === 'space') expect(r.space.id).toBe('only');
		}
	});

	test('single-space-mode degenerate index: /admin on the admin host still short-circuits', () => {
		const d: FakeSpace = { id: 'only' };
		const r = resolve(index({ default: d }), 'admin.example.com', '/admin');
		expect(r.kind).toBe('admin');
	});
});
