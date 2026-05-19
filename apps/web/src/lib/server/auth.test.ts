import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';
import { isAuthor, requireAuthor } from './auth.ts';

const stubEvent = {} as RequestEvent;

describe('auth seam', () => {
	const original = process.env.AMBER_DEV_UNSAFE;
	beforeEach(() => {
		delete process.env.AMBER_DEV_UNSAFE;
	});
	afterEach(() => {
		if (original === undefined) delete process.env.AMBER_DEV_UNSAFE;
		else process.env.AMBER_DEV_UNSAFE = original;
	});

	test('isAuthor is false by default (flag unset)', () => {
		expect(isAuthor(stubEvent)).toBe(false);
	});

	test('isAuthor is true when AMBER_DEV_UNSAFE=1', () => {
		process.env.AMBER_DEV_UNSAFE = '1';
		expect(isAuthor(stubEvent)).toBe(true);
	});

	test('requireAuthor throws 401 by default', () => {
		try {
			requireAuthor(stubEvent);
			expect.unreachable('requireAuthor should have thrown');
		} catch (e) {
			expect((e as { status: number }).status).toBe(401);
		}
	});

	test('requireAuthor does not throw when AMBER_DEV_UNSAFE=1', () => {
		process.env.AMBER_DEV_UNSAFE = '1';
		expect(() => requireAuthor(stubEvent)).not.toThrow();
	});
});
