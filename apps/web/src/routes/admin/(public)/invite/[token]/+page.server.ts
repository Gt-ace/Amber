/**
 * /admin/invite/[token] — invite redemption (spec §4).
 *
 * Load: 410 on unknown/expired/redeemed; otherwise branch on session into
 * one of four states (signed-out / install-admin / already-member /
 * non-member-signed-in). Headers force no-referrer + no-store so the
 * bearer token in the URL doesn't leak via Referer or shared caches.
 */

import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getAuthDb } from '$lib/server/auth-config';
import { hashToken, lookupByTokenHash, type InviteRow } from '$lib/server/invites';
import { getRole } from '$lib/server/permissions';
import { getRegistryEntries } from '$lib/server/space';
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

export const load: PageServerLoad = async ({ params, locals, setHeaders }) => {
	setHeaders({
		'Referrer-Policy': 'no-referrer',
		'Cache-Control': 'no-store'
	});

	const db = getAuthDb();
	const row = lookupByTokenHash(db, hashToken(params.token));
	if (!row) error(410, 'This invite link is no longer valid.');
	if (row.redeemed_at != null) error(410, 'This invite has already been used.');
	if (row.expires_at < Date.now()) error(410, 'This invite has expired.');

	const invite = shape(row);

	if (!locals.user) {
		const state: LoadState = { kind: 'signed-out', invite };
		return { state };
	}
	if (locals.user.isInstallAdmin) {
		const state: LoadState = { kind: 'install-admin', invite };
		return { state };
	}
	const currentRole = getRole(locals.user.id, row.space_slug);
	if (currentRole) {
		const state: LoadState = { kind: 'already-member', invite, currentRole };
		return { state };
	}
	const state: LoadState = {
		kind: 'accept-as-current',
		invite,
		email: locals.user.email
	};
	return { state };
};
