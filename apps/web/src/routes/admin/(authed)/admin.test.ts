import { describe, expect, test } from 'vitest';
import type { LayoutServerLoad } from './$types';
import { load } from './+layout.server.ts';

type LoadEvent = Parameters<LayoutServerLoad>[0];

function eventFor(
	user: { id: string; email: string; name?: string | null; isInstallAdmin: boolean } | null,
	pathname = '/admin/edit/about',
	search = ''
): LoadEvent {
	return {
		locals: { user },
		url: { pathname, search } as URL
	} as unknown as LoadEvent;
}

describe('(authed) layout guard', () => {
	test('redirects to /admin/login with ?next= when locals.user is null', () => {
		try {
			load(eventFor(null, '/admin/edit/about'));
			expect.unreachable('the guard should have redirected');
		} catch (e) {
			const r = e as { status: number; location: string };
			expect(r.status).toBe(302);
			expect(r.location).toBe('/admin/login?next=' + encodeURIComponent('/admin/edit/about'));
		}
	});

	test('preserves query string in next param', () => {
		try {
			load(eventFor(null, '/admin/new', '?from=button'));
			expect.unreachable('the guard should have redirected');
		} catch (e) {
			const r = e as { status: number; location: string };
			expect(r.location).toBe('/admin/login?next=' + encodeURIComponent('/admin/new?from=button'));
		}
	});

	test('returns the user when locals.user is set', () => {
		const user = { id: 'u1', email: 'a@x', name: 'Admin', isInstallAdmin: false };
		expect(load(eventFor(user))).toEqual({ user });
	});
});
