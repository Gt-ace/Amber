/**
 * Tests for `parseSpaceRouting()`. Pure function: input is `(SpaceConfig,
 * slug, adminHost)`, output is `{ routing, warnings }`. Spec §4 enforces the
 * per-space rules; cross-space conflicts live in resolver-index.ts.
 */

import { describe, expect, test } from 'vitest';
import { parseSpaceRouting } from './space-routing';
import type { SpaceConfig } from '$lib/space/config';

const ADMIN = 'admin.example.com';

describe('parseSpaceRouting()', () => {
	test('empty config → unreachable warning, no routing', () => {
		const r = parseSpaceRouting({}, 'site', ADMIN);
		expect(r.routing).toEqual({ host: null, prefix: null, default: false });
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_unreachable');
	});

	test('host + prefix both set → space_routing_conflict, both dropped', () => {
		const cfg: SpaceConfig = { host: 'a.example.com', prefix: '/a' };
		const r = parseSpaceRouting(cfg, 'site', ADMIN);
		expect(r.routing.host).toBeNull();
		expect(r.routing.prefix).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_conflict');
	});

	test('host containing scheme → space_routing_invalid_host, dropped', () => {
		const r = parseSpaceRouting({ host: 'https://a.example.com' }, 'site', ADMIN);
		expect(r.routing.host).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_invalid_host');
	});

	test('host containing path → invalid_host', () => {
		const r = parseSpaceRouting({ host: 'a.example.com/foo' }, 'site', ADMIN);
		expect(r.routing.host).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_invalid_host');
	});

	test('host containing port → invalid_host', () => {
		const r = parseSpaceRouting({ host: 'a.example.com:8080' }, 'site', ADMIN);
		expect(r.routing.host).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_invalid_host');
	});

	test('host wildcard → invalid_host', () => {
		const r = parseSpaceRouting({ host: '*.example.com' }, 'site', ADMIN);
		expect(r.routing.host).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_invalid_host');
	});

	test('host equals admin host → admin_host_collision, dropped', () => {
		const r = parseSpaceRouting({ host: ADMIN }, 'site', ADMIN);
		expect(r.routing.host).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_admin_host_collision');
	});

	test('valid host → kept', () => {
		const r = parseSpaceRouting({ host: 'amber.example.com' }, 'site', ADMIN);
		expect(r.routing.host).toBe('amber.example.com');
		expect(r.warnings).toEqual([]);
	});

	test('prefix without leading slash → invalid_prefix', () => {
		const r = parseSpaceRouting({ prefix: 'scratch' }, 'site', ADMIN);
		expect(r.routing.prefix).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_invalid_prefix');
	});

	test('prefix = "/" → invalid_prefix', () => {
		const r = parseSpaceRouting({ prefix: '/' }, 'site', ADMIN);
		expect(r.routing.prefix).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_invalid_prefix');
	});

	test('prefix ending in / → invalid_prefix', () => {
		const r = parseSpaceRouting({ prefix: '/scratch/' }, 'site', ADMIN);
		expect(r.routing.prefix).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_invalid_prefix');
	});

	test('prefix containing ? → invalid_prefix', () => {
		const r = parseSpaceRouting({ prefix: '/scratch?x' }, 'site', ADMIN);
		expect(r.routing.prefix).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_invalid_prefix');
	});

	test('valid prefix → kept', () => {
		const r = parseSpaceRouting({ prefix: '/scratch' }, 'site', ADMIN);
		expect(r.routing.prefix).toBe('/scratch');
		expect(r.warnings).toEqual([]);
	});

	test.each([
		'/admin',
		'/admin/elsewhere',
		'/api',
		'/api/auth',
		'/themes',
		'/themes/foo',
		'/sitemap.xml',
		'/robots.txt',
		'/favicon.ico'
	])('reserved prefix %s → reserved_prefix, dropped', (p) => {
		const r = parseSpaceRouting({ prefix: p }, 'site', ADMIN);
		expect(r.routing.prefix).toBeNull();
		expect(r.warnings.map((w) => w.code)).toContain('space_routing_reserved_prefix');
	});

	test('prefix that only shares a name root with a reserved path is fine', () => {
		// `/adminstrative` does not start with `/admin/` and is not equal to
		// `/admin`, so it should be kept.
		const r = parseSpaceRouting({ prefix: '/adminstrative' }, 'site', ADMIN);
		expect(r.routing.prefix).toBe('/adminstrative');
		expect(r.warnings).toEqual([]);
	});

	test('default = true alone → kept, no warning', () => {
		const r = parseSpaceRouting({ default: true }, 'site', ADMIN);
		expect(r.routing.default).toBe(true);
		expect(r.warnings).toEqual([]);
	});

	test('host + default → both kept (a default with a host is valid)', () => {
		const r = parseSpaceRouting({ host: 'a.example.com', default: true }, 'site', ADMIN);
		expect(r.routing.host).toBe('a.example.com');
		expect(r.routing.default).toBe(true);
	});
});
