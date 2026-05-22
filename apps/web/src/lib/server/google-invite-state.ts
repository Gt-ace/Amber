/**
 * Signed state token for Google-OAuth invite redemption (spec §4).
 *
 * better-auth's social flow accepts a `callbackURL` we can prefill, but the
 * invite-id needs to round-trip *through* Google's authorize redirect, which
 * mutates query strings. We sign the invite-id under AMBER_AUTH_SECRET so a
 * tampered state on return doesn't let a stranger claim an invite. Single-use
 * via timestamp + a redemption check inside the action.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

const MAX_AGE_MS = 30 * 60 * 1000;

function key(): Buffer {
	const secret = process.env.AMBER_AUTH_SECRET;
	if (!secret) throw new Error('AMBER_AUTH_SECRET is required for invite-state signing.');
	return Buffer.from(secret);
}

export function signInviteState(inviteId: string, now: number = Date.now()): string {
	const payload = `${inviteId}:${now}`;
	const sig = createHmac('sha256', key()).update(payload).digest('base64url');
	return `${Buffer.from(payload).toString('base64url')}.${sig}`;
}

export function verifyInviteState(state: string, now: number = Date.now()): string | null {
	const dot = state.indexOf('.');
	if (dot < 0) return null;
	const payloadB64 = state.slice(0, dot);
	const sig = state.slice(dot + 1);
	let payload: string;
	try {
		payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
	} catch {
		return null;
	}
	const expected = createHmac('sha256', key()).update(payload).digest('base64url');
	const a = Buffer.from(sig);
	const b = Buffer.from(expected);
	if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
	const [inviteId, tsRaw] = payload.split(':');
	const ts = Number(tsRaw);
	if (!inviteId || !Number.isFinite(ts)) return null;
	if (now - ts > MAX_AGE_MS) return null;
	return inviteId;
}
