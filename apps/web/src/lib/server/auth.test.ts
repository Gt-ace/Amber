import { describe, expect, test } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { isAuthor, requireAuthor } from './auth.ts';

function eventWith(user: { id: string; email: string; name?: string | null } | null) {
	return { locals: { user } } as unknown as RequestEvent;
}

describe('auth seam', () => {
	test('isAuthor is false when locals.user is null', () => {
		expect(isAuthor(eventWith(null))).toBe(false);
	});

	test('isAuthor is true when locals.user is set', () => {
		expect(isAuthor(eventWith({ id: 'u1', email: 'a@x' }))).toBe(true);
	});

	test('requireAuthor throws 401 when locals.user is null', () => {
		try {
			requireAuthor(eventWith(null));
			expect.unreachable('requireAuthor should have thrown');
		} catch (e) {
			expect((e as { status: number }).status).toBe(401);
		}
	});

	test('requireAuthor does not throw when locals.user is set', () => {
		expect(() => requireAuthor(eventWith({ id: 'u1', email: 'a@x' }))).not.toThrow();
	});
});
