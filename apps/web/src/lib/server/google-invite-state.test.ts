import { describe, expect, test } from 'vitest';
import { signInviteState, verifyInviteState } from './google-invite-state';

const ORIGINAL_SECRET = process.env.AMBER_AUTH_SECRET;

describe('google-invite-state', () => {
	test('round-trips a valid id', () => {
		process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
		const state = signInviteState('inv-1');
		expect(verifyInviteState(state)).toBe('inv-1');
		process.env.AMBER_AUTH_SECRET = ORIGINAL_SECRET;
	});

	test('rejects a tampered signature', () => {
		process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
		const state = signInviteState('inv-1');
		const tampered = state.slice(0, -2) + 'AA';
		expect(verifyInviteState(tampered)).toBeNull();
		process.env.AMBER_AUTH_SECRET = ORIGINAL_SECRET;
	});

	test('rejects a stale state (> 30 minutes)', () => {
		process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
		const longAgo = Date.now() - 60 * 60 * 1000;
		const state = signInviteState('inv-1', longAgo);
		expect(verifyInviteState(state)).toBeNull();
		process.env.AMBER_AUTH_SECRET = ORIGINAL_SECRET;
	});

	test('rejects a different secret', () => {
		process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
		const state = signInviteState('inv-1');
		process.env.AMBER_AUTH_SECRET = 'y'.repeat(32);
		expect(verifyInviteState(state)).toBeNull();
		process.env.AMBER_AUTH_SECRET = ORIGINAL_SECRET;
	});
});
