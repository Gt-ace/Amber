import { describe, expect, test } from 'vitest';
import { validateCreateInput, type RegistrySnapshot } from './space-create-validate';

function snapshot(over: Partial<RegistrySnapshot> = {}): RegistrySnapshot {
	return {
		slugs: new Set<string>(),
		hosts: new Map<string, string>(),
		prefixes: new Map<string, string>(),
		defaultOwner: null,
		adminHost: 'admin.test',
		...over
	};
}

describe('validateCreateInput', () => {
	test('happy path: prefix routing', () => {
		const r = validateCreateInput(
			{ title: 'Notes', slug: 'notes', routingKind: 'prefix', host: '', prefix: '/notes' },
			snapshot()
		);
		expect(r.valid).toEqual({
			slug: 'notes',
			title: 'Notes',
			routing: { kind: 'prefix', prefix: '/notes' }
		});
		expect(r.errors).toEqual([]);
	});

	test('happy path: host routing', () => {
		const r = validateCreateInput(
			{ title: 'Mira', slug: 'mira', routingKind: 'host', host: 'mira.example.com', prefix: '' },
			snapshot()
		);
		expect(r.valid?.routing).toEqual({ kind: 'host', host: 'mira.example.com' });
	});

	test('happy path: default', () => {
		const r = validateCreateInput(
			{ title: 'Home', slug: 'home', routingKind: 'default', host: '', prefix: '' },
			snapshot()
		);
		expect(r.valid?.routing).toEqual({ kind: 'default' });
	});

	test('happy path: admin-only', () => {
		const r = validateCreateInput(
			{ title: 'Scratch', slug: 'scratch', routingKind: 'admin-only', host: '', prefix: '' },
			snapshot()
		);
		expect(r.valid?.routing).toEqual({ kind: 'admin-only' });
	});

	test('title_empty', () => {
		const r = validateCreateInput(
			{ title: '   ', slug: 'a', routingKind: 'admin-only', host: '', prefix: '' },
			snapshot()
		);
		expect(r.valid).toBeNull();
		expect(r.errors).toContainEqual({ field: 'title', code: 'title_empty' });
	});

	test('slug_invalid: uppercase', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'BadSlug', routingKind: 'admin-only', host: '', prefix: '' },
			snapshot()
		);
		expect(r.errors).toContainEqual({ field: 'slug', code: 'slug_invalid' });
	});

	test('slug_invalid: leading hyphen', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: '-bad', routingKind: 'admin-only', host: '', prefix: '' },
			snapshot()
		);
		expect(r.errors).toContainEqual({ field: 'slug', code: 'slug_invalid' });
	});

	test('slug_invalid: empty', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: '', routingKind: 'admin-only', host: '', prefix: '' },
			snapshot()
		);
		expect(r.errors).toContainEqual({ field: 'slug', code: 'slug_invalid' });
	});

	test('slug_taken', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'taken', routingKind: 'admin-only', host: '', prefix: '' },
			snapshot({ slugs: new Set(['taken']) })
		);
		expect(r.errors).toContainEqual({ field: 'slug', code: 'slug_taken' });
	});

	test('host_invalid: scheme present', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'x', routingKind: 'host', host: 'https://x.example', prefix: '' },
			snapshot()
		);
		expect(r.errors).toContainEqual({ field: 'host', code: 'host_invalid' });
	});

	test('host_invalid: empty', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'x', routingKind: 'host', host: '', prefix: '' },
			snapshot()
		);
		expect(r.errors).toContainEqual({ field: 'host', code: 'host_invalid' });
	});

	test('host_is_admin', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'x', routingKind: 'host', host: 'admin.test', prefix: '' },
			snapshot()
		);
		expect(r.errors).toContainEqual({ field: 'host', code: 'host_is_admin' });
	});

	test('host_taken', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'x', routingKind: 'host', host: 'a.example', prefix: '' },
			snapshot({ hosts: new Map([['a.example', 'other']]) })
		);
		expect(r.errors).toContainEqual({ field: 'host', code: 'host_taken' });
	});

	test('prefix_invalid: missing slash', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'x', routingKind: 'prefix', host: '', prefix: 'notes' },
			snapshot()
		);
		expect(r.errors).toContainEqual({ field: 'prefix', code: 'prefix_invalid' });
	});

	test('prefix_invalid: trailing slash', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'x', routingKind: 'prefix', host: '', prefix: '/notes/' },
			snapshot()
		);
		expect(r.errors).toContainEqual({ field: 'prefix', code: 'prefix_invalid' });
	});

	test('prefix_reserved: /admin', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'x', routingKind: 'prefix', host: '', prefix: '/admin' },
			snapshot()
		);
		expect(r.errors).toContainEqual({ field: 'prefix', code: 'prefix_reserved' });
	});

	test('prefix_reserved: /sitemap.xml (exact-match path)', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'x', routingKind: 'prefix', host: '', prefix: '/sitemap.xml' },
			snapshot()
		);
		expect(r.errors).toContainEqual({ field: 'prefix', code: 'prefix_reserved' });
	});

	test('prefix_taken', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'x', routingKind: 'prefix', host: '', prefix: '/notes' },
			snapshot({ prefixes: new Map([['/notes', 'other']]) })
		);
		expect(r.errors).toContainEqual({ field: 'prefix', code: 'prefix_taken' });
	});

	test('default_taken', () => {
		const r = validateCreateInput(
			{ title: 'X', slug: 'x', routingKind: 'default', host: '', prefix: '' },
			snapshot({ defaultOwner: 'other' })
		);
		expect(r.errors).toContainEqual({ field: 'default', code: 'default_taken' });
	});
});
