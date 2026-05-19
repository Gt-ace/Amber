import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { LayoutServerLoad } from './$types';

const stubEvent = {} as Parameters<LayoutServerLoad>[0];

describe('admin +layout.server guard', () => {
	const original = process.env.AMBER_DEV_UNSAFE;
	beforeEach(() => {
		delete process.env.AMBER_DEV_UNSAFE;
	});
	afterEach(() => {
		if (original === undefined) delete process.env.AMBER_DEV_UNSAFE;
		else process.env.AMBER_DEV_UNSAFE = original;
	});

	test('denies access with a 401 when AMBER_DEV_UNSAFE is unset', async () => {
		const { load } = await import('./+layout.server.ts');
		try {
			load(stubEvent);
			expect.unreachable('the guard should have thrown');
		} catch (e) {
			expect((e as { status: number }).status).toBe(401);
		}
	});

	test('allows access when AMBER_DEV_UNSAFE=1', async () => {
		process.env.AMBER_DEV_UNSAFE = '1';
		const { load } = await import('./+layout.server.ts');
		expect(load(stubEvent)).toEqual({});
	});
});
