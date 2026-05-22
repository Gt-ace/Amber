/**
 * /admin/spaces/[slug]/members — owner-only members admin (spec §2, §4).
 *
 * Editors get 403 (the layout above us has already enforced membership;
 * `requireSpaceAccess(..., 'owner')` upgrades the floor). Owners and the
 * install-admin pass.
 */

import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireSpaceAccess, listMembers, removeMember, upsertMember } from '$lib/server/permissions';
import {
	insertInvite,
	listPendingForSpace,
	revokeInvite,
	lookupById,
	type InviteRole
} from '$lib/server/invites';
import { getAuthDb } from '$lib/server/auth-config';
import { logger } from '$lib/server/logger';

const log = logger.child({ subsystem: 'permissions' });

function publicUrl(): string {
	return process.env.AMBER_PUBLIC_URL!.replace(/\/$/, '');
}

export const load: PageServerLoad = async (event) => {
	requireSpaceAccess(event, event.params.slug, 'owner');
	const members = listMembers(event.params.slug);
	const invites = listPendingForSpace(getAuthDb(), event.params.slug);
	return { members, invites };
};

export const actions: Actions = {
	generateInvite: async (event) => {
		requireSpaceAccess(event, event.params.slug, 'owner');
		const form = await event.request.formData();
		const role = String(form.get('role') ?? '') as InviteRole;
		if (role !== 'owner' && role !== 'editor') {
			return fail(400, { generate: { ok: false as const, error: 'Pick a role.' } });
		}
		const { id, token } = insertInvite(getAuthDb(), {
			spaceSlug: event.params.slug,
			role,
			createdBy: event.locals.user!.id
		});
		const inviteUrl = `${publicUrl()}/admin/invite/${token}`;
		log.info(
			{ code: 'invite_generated', actorId: event.locals.user!.id, slug: event.params.slug, role, inviteId: id },
			'invite generated'
		);
		// The token leaves the server exactly once — here.
		return { generate: { ok: true as const, inviteUrl, role } };
	},

	revokeInvite: async (event) => {
		requireSpaceAccess(event, event.params.slug, 'owner');
		const form = await event.request.formData();
		const inviteId = String(form.get('inviteId') ?? '');
		if (!inviteId) return fail(400, { revoke: { ok: false as const, error: 'Missing id.' } });
		const db = getAuthDb();
		const row = lookupById(db, inviteId);
		if (!row || row.space_slug !== event.params.slug) {
			return fail(404, { revoke: { ok: false as const, error: 'Unknown invite.' } });
		}
		revokeInvite(db, inviteId);
		log.info(
			{ code: 'invite_revoked', actorId: event.locals.user!.id, slug: event.params.slug, inviteId },
			'invite revoked'
		);
		return { revoke: { ok: true as const } };
	},

	changeRole: async (event) => {
		requireSpaceAccess(event, event.params.slug, 'owner');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		const role = String(form.get('role') ?? '') as InviteRole;
		if (!userId || (role !== 'owner' && role !== 'editor')) {
			return fail(400, { change: { ok: false as const, error: 'Missing fields.' } });
		}
		const db = getAuthDb();
		const target = db.query('SELECT isInstallAdmin FROM user WHERE id = ?1').get(userId) as
			| { isInstallAdmin: number }
			| undefined;
		if (target?.isInstallAdmin) {
			return fail(400, {
				change: {
					ok: false as const,
					error: 'This user is the install-admin; their access is implicit and cannot be changed here.'
				}
			});
		}
		upsertMember(userId, event.params.slug, role, event.locals.user!.id);
		log.info(
			{
				code: 'member_role_changed',
				actorId: event.locals.user!.id,
				userId,
				slug: event.params.slug,
				to: role
			},
			'member role changed'
		);
		return { change: { ok: true as const } };
	},

	removeMember: async (event) => {
		requireSpaceAccess(event, event.params.slug, 'owner');
		const form = await event.request.formData();
		const userId = String(form.get('userId') ?? '');
		if (!userId) return fail(400, { remove: { ok: false as const, error: 'Missing user id.' } });
		const db = getAuthDb();
		const target = db.query('SELECT isInstallAdmin FROM user WHERE id = ?1').get(userId) as
			| { isInstallAdmin: number }
			| undefined;
		if (target?.isInstallAdmin) {
			return fail(400, {
				remove: {
					ok: false as const,
					error: 'The install-admin has implicit ownership; they cannot be removed from a space here.'
				}
			});
		}
		removeMember(userId, event.params.slug);
		log.info(
			{ code: 'member_removed', actorId: event.locals.user!.id, userId, slug: event.params.slug },
			'member removed'
		);
		return { remove: { ok: true as const } };
	}
};
