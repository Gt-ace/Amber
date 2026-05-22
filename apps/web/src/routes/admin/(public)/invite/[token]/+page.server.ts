/**
 * /admin/invite/[token] — invite redemption (spec §4).
 *
 * Load: 410 on unknown/expired/redeemed; otherwise branch on session into
 * one of four states (signed-out / install-admin / already-member /
 * non-member-signed-in). Headers force no-referrer + no-store so the
 * bearer token in the URL doesn't leak via Referer or shared caches.
 */

import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { getAuth, getAuthDb, resolveGoogleEnv } from '$lib/server/auth-config';
import { hashToken, loadValidByTokenHash, lookupById, lookupByTokenHash, markRedeemed, type InviteRow } from '$lib/server/invites';
import { getRole, upsertMember } from '$lib/server/permissions';
import { getRegistryEntries } from '$lib/server/space';
import { inviteContext } from '$lib/server/invite-context';
import { signInviteState, verifyInviteState } from '$lib/server/google-invite-state';
import { APIError } from 'better-auth/api';
import { logger } from '$lib/server/logger';
import path from 'node:path';

interface PublicInvite {
	id: string;
	slug: string;
	role: 'owner' | 'editor';
	spaceTitle: string | null;
	expiresAt: number;
}

type LoadState =
	| { kind: 'signed-out'; invite: PublicInvite }
	| { kind: 'install-admin'; invite: PublicInvite }
	| { kind: 'already-member'; invite: PublicInvite; currentRole: 'owner' | 'editor' }
	| { kind: 'accept-as-current'; invite: PublicInvite; email: string };

function shape(row: InviteRow): PublicInvite {
	const entry = getRegistryEntries().find((e) => path.basename(e.path) === row.space_slug);
	return {
		id: row.id,
		slug: row.space_slug,
		role: row.role,
		spaceTitle: entry?.space.manifest.site?.title ?? null,
		expiresAt: row.expires_at
	};
}

export const load: PageServerLoad = async ({ params, locals, setHeaders, url }) => {
	setHeaders({
		'Referrer-Policy': 'no-referrer',
		'Cache-Control': 'no-store'
	});

	// Google-OAuth finalize: signed-in user returning from Google with a
	// signed gstate that encodes the invite-id. Verify, redeem, redirect.
	const gstate = url.searchParams.get('gstate');
	if (gstate && locals.user && !locals.user.isInstallAdmin) {
		const inviteId = verifyInviteState(gstate);
		if (inviteId) {
			const db = getAuthDb();
			const inviteRow = lookupById(db, inviteId);
			if (inviteRow && inviteRow.redeemed_at == null && inviteRow.expires_at >= Date.now()) {
				const existing = getRole(locals.user.id, inviteRow.space_slug);
				if (!existing) {
					const userId = locals.user.id;
					db.transaction(() => {
						const fresh = db
							.query('SELECT redeemed_at FROM invite WHERE id = ?1')
							.get(inviteRow.id) as { redeemed_at: number | null } | undefined;
						if (!fresh || fresh.redeemed_at != null) return;
						upsertMember(userId, inviteRow.space_slug, inviteRow.role, inviteRow.created_by);
						markRedeemed(db, { id: inviteRow.id, userId });
					})();
					redirect(302, `/admin/spaces/${inviteRow.space_slug}`);
				}
			}
		}
	}

	const db = getAuthDb();
	const row = lookupByTokenHash(db, hashToken(params.token));
	if (!row) error(410, 'This invite link is no longer valid.');
	if (row.redeemed_at != null) error(410, 'This invite has already been used.');
	if (row.expires_at < Date.now()) error(410, 'This invite has expired.');

	const invite = shape(row);

	if (!locals.user) {
		const state: LoadState = { kind: 'signed-out', invite };
		return { state, googleEnabled: resolveGoogleEnv() != null, inviteSignedState: signInviteState(row.id) };
	}
	if (locals.user.isInstallAdmin) {
		const state: LoadState = { kind: 'install-admin', invite };
		return { state, googleEnabled: resolveGoogleEnv() != null, inviteSignedState: signInviteState(row.id) };
	}
	const currentRole = getRole(locals.user.id, row.space_slug);
	if (currentRole) {
		const state: LoadState = { kind: 'already-member', invite, currentRole };
		return { state, googleEnabled: resolveGoogleEnv() != null, inviteSignedState: signInviteState(row.id) };
	}
	const state: LoadState = {
		kind: 'accept-as-current',
		invite,
		email: locals.user.email
	};
	return { state, googleEnabled: resolveGoogleEnv() != null, inviteSignedState: signInviteState(row.id) };
};

const log = logger.child({ subsystem: 'permissions' });

export const actions: Actions = {
	redeemAsNew: async (event) => {
		const form = await event.request.formData();
		const email = String(form.get('email') ?? '').trim();
		const password = String(form.get('password') ?? '');
		const name = String(form.get('name') ?? '').trim() || email.split('@')[0] || 'user';

		if (!email || !password) {
			return fail(400, { redeem: { ok: false as const, error: 'Email and password are required.' } });
		}
		if (password.length < 8) {
			return fail(400, { redeem: { ok: false as const, error: 'Password must be at least 8 characters.' } });
		}

		const db = getAuthDb();
		const row = loadValidByTokenHash(db, hashToken(event.params.token));
		if (!row) {
			return fail(410, { redeem: { ok: false as const, error: 'This invite is no longer valid.' } });
		}

		const auth = await getAuth();
		try {
			await inviteContext.run({ pendingInviteId: row.id }, async () => {
				await auth.api.signUpEmail({
					body: { email, password, name },
					headers: event.request.headers
				});
			});
		} catch (e) {
			if (e instanceof APIError) {
				const msg = (e as APIError & { body?: { message?: string } }).body?.message ?? e.message;
				if (msg.toLowerCase().includes('email')) {
					return fail(409, {
						redeem: {
							ok: false as const,
							error:
								'This email already has an account. Sign in to claim this invite instead.'
						}
					});
				}
				return fail(400, { redeem: { ok: false as const, error: msg } });
			}
			throw e;
		}

		// Re-fetch the freshly-created user id by email and finalize.
		const user = db.query('SELECT id FROM user WHERE email = ?1').get(email) as
			| { id: string }
			| undefined;
		if (!user) {
			return fail(500, {
				redeem: { ok: false as const, error: 'User row not found after sign-up; please try again.' }
			});
		}

		// Race re-check + atomic finalization. If the invite was redeemed
		// or expired between the load above and now, the transaction throws
		// out of `db.transaction()` and we return 410.
		let raced = false;
		try {
			db.transaction(() => {
				const fresh = db
					.query('SELECT redeemed_at, expires_at FROM invite WHERE id = ?1')
					.get(row.id) as { redeemed_at: number | null; expires_at: number } | undefined;
				if (!fresh || fresh.redeemed_at != null || fresh.expires_at < Date.now()) {
					raced = true;
					throw new Error('invite_raced');
				}
				upsertMember(user.id, row.space_slug, row.role, row.created_by);
				markRedeemed(db, { id: row.id, userId: user.id });
			})();
		} catch (e) {
			if (raced) {
				return fail(410, { redeem: { ok: false as const, error: 'This invite is no longer valid.' } });
			}
			throw e;
		}

		log.info(
			{ code: 'invite_redeemed', inviteId: row.id, userId: user.id, slug: row.space_slug, role: row.role },
			'invite redeemed (new user)'
		);
		log.info(
			{ code: 'member_added', actorId: row.created_by, userId: user.id, slug: row.space_slug, role: row.role, via: 'invite' },
			'member added via invite'
		);

		redirect(302, `/admin/spaces/${row.space_slug}`);
	},

	redeemAsCurrent: async (event) => {
		if (!event.locals.user) {
			return fail(401, { redeem: { ok: false as const, error: 'Sign in first.' } });
		}
		if (event.locals.user.isInstallAdmin) {
			return fail(400, {
				redeem: {
					ok: false as const,
					error:
						'You are the install-admin and already have access. Use "Revoke this invite" to clean up.'
				}
			});
		}

		const db = getAuthDb();
		const row = loadValidByTokenHash(db, hashToken(event.params.token));
		if (!row) {
			return fail(410, { redeem: { ok: false as const, error: 'This invite is no longer valid.' } });
		}

		// Already-member: refuse to consume the invite.
		const existing = getRole(event.locals.user.id, row.space_slug);
		if (existing) {
			return fail(409, {
				redeem: {
					ok: false as const,
					error: `You already have ${existing} access to this space.`
				}
			});
		}

		const userId = event.locals.user.id;
		let raced = false;
		try {
			db.transaction(() => {
				const fresh = db
					.query('SELECT redeemed_at, expires_at FROM invite WHERE id = ?1')
					.get(row.id) as { redeemed_at: number | null; expires_at: number } | undefined;
				if (!fresh || fresh.redeemed_at != null || fresh.expires_at < Date.now()) {
					raced = true;
					throw new Error('invite_raced');
				}
				upsertMember(userId, row.space_slug, row.role, row.created_by);
				markRedeemed(db, { id: row.id, userId });
			})();
		} catch (e) {
			if (raced) {
				return fail(410, { redeem: { ok: false as const, error: 'This invite is no longer valid.' } });
			}
			throw e;
		}

		log.info(
			{ code: 'invite_redeemed', inviteId: row.id, userId, slug: row.space_slug, role: row.role },
			'invite redeemed (existing user)'
		);
		log.info(
			{ code: 'member_added', actorId: row.created_by, userId, slug: row.space_slug, role: row.role, via: 'invite' },
			'member added via invite'
		);
		redirect(302, `/admin/spaces/${row.space_slug}`);
	},

	revokeIfAdmin: async (event) => {
		if (!event.locals.user?.isInstallAdmin) {
			return fail(403, { revoke: { ok: false as const, error: 'Install-admin only.' } });
		}
		const db = getAuthDb();
		const row = lookupByTokenHash(db, hashToken(event.params.token));
		if (!row) return fail(404, { revoke: { ok: false as const, error: 'Unknown invite.' } });
		db.run('DELETE FROM invite WHERE id = ?1 AND redeemed_at IS NULL', [row.id]);
		log.info(
			{ code: 'invite_revoked', actorId: event.locals.user.id, inviteId: row.id, slug: row.space_slug },
			'invite revoked by install-admin from redemption page'
		);
		return { revoke: { ok: true as const } };
	},

	revokeIfOwner: async (event) => {
		// Spec §4 — invitee who's already a member can revoke if they're owner
		// of the target space (i.e., they could have generated this invite).
		if (!event.locals.user || event.locals.user.isInstallAdmin) {
			return fail(403, { revoke: { ok: false as const, error: 'Owner only.' } });
		}
		const db = getAuthDb();
		const row = lookupByTokenHash(db, hashToken(event.params.token));
		if (!row) return fail(404, { revoke: { ok: false as const, error: 'Unknown invite.' } });
		const role = getRole(event.locals.user.id, row.space_slug);
		if (role !== 'owner') {
			return fail(403, { revoke: { ok: false as const, error: 'Owner only.' } });
		}
		db.run('DELETE FROM invite WHERE id = ?1 AND redeemed_at IS NULL', [row.id]);
		log.info(
			{ code: 'invite_revoked', actorId: event.locals.user.id, inviteId: row.id, slug: row.space_slug },
			'invite revoked by space owner from redemption page'
		);
		return { revoke: { ok: true as const } };
	}
};
