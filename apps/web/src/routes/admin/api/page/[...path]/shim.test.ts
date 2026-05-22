/**
 * v0.5 subsystem 3 followup #9 — the PUT 308 shim must refuse anonymous
 * requests. It lives outside the `(authed)` group, so the route guard that
 * covers `/admin/spaces/[slug]/api/page/...` doesn't reach here. Without an
 * explicit `requireAuthor` it would 308 to `/admin/spaces/<default-slug>/...`
 * (leaking the configured default slug) or `404 No spaces loaded` (leaking
 * load state). The v0.4 handler returned 401 uniformly; this contract test
 * locks that back in.
 */

import { afterAll, beforeEach, describe, expect, test } from 'vitest';
import { setDefaultSlug, getDefaultSlug } from '$lib/server/default-space';
import { PUT } from './+server';

const callPut = (user: { id: string; email: string; isInstallAdmin: boolean } | null) =>
	PUT({
		params: { path: 'about' },
		url: new URL('http://localhost/admin/api/page/about'),
		locals: { user, log: console as never },
		request: new Request('http://localhost/admin/api/page/about', { method: 'PUT' })
	} as unknown as Parameters<typeof PUT>[0]);

describe('PUT /admin/api/page/[...path] shim', () => {
	const original = getDefaultSlug();
	beforeEach(() => {
		setDefaultSlug('the-default');
	});
	afterAll(() => {
		setDefaultSlug(original);
	});

	test('without an authenticated user → 401, no Location header', async () => {
		try {
			await callPut(null);
			throw new Error('expected requireAuthor to throw');
		} catch (e) {
			// SvelteKit's `error(401)` throws an HttpError shape.
			const err = e as { status?: number };
			expect(err.status).toBe(401);
		}
	});

	test('with an authenticated user → 308 to the configured default slug', async () => {
		const res = (await callPut({ id: 'u1', email: 'a@x', isInstallAdmin: false })) as Response;
		expect(res.status).toBe(308);
		expect(res.headers.get('location')).toBe('/admin/spaces/the-default/api/page/about');
	});

	test('with no default slug set → 404 No spaces loaded (auth still required first)', async () => {
		setDefaultSlug(null);
		const res = (await callPut({ id: 'u1', email: 'a@x', isInstallAdmin: false })) as Response;
		expect(res.status).toBe(404);
		expect(await res.text()).toBe('No spaces loaded');
	});
});
