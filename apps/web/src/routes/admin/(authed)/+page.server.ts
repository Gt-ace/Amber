/**
 * Space picker (spec §2, §13). Lists every loaded space visible to the
 * current user:
 *   - install-admin → every loaded space.
 *   - any other signed-in user → only spaces with a matching `member` row.
 *
 * Single-space-mode 302 fires against the *filtered* list, so a normal
 * editor whose only membership is on space A lands directly on it.
 *
 * Empty-state copy is two-variant per spec §13:
 *   - install has spaces, user has no memberships → "ask your admin to invite you".
 *   - install has zero spaces → "no spaces loaded".
 */

import { redirect } from '@sveltejs/kit';
import path from 'node:path';
import type { PageServerLoad } from './$types';
import { getRegistryEntries } from '$lib/server/space';
import { getAuthDb } from '$lib/server/auth-config';

export const load = (({ locals }) => {
	const allEntries = getRegistryEntries();
	const user = locals.user!; // (authed) layout has already redirected null users

	const visible = user.isInstallAdmin
		? allEntries
		: (() => {
				const slugs = new Set(
					(
						getAuthDb()
							.query('SELECT space_slug FROM member WHERE user_id = ?')
							.all(user.id) as Array<{ space_slug: string }>
					).map((r) => r.space_slug)
				);
				return allEntries.filter((e) => slugs.has(path.basename(e.path)));
			})();

	if (visible.length === 1) {
		const slug = path.basename(visible[0].path);
		redirect(302, `/admin/spaces/${slug}`);
	}

	const list = visible
		.map((e) => ({
			slug: path.basename(e.path),
			title: e.space.manifest.site?.title ?? path.basename(e.path)
		}))
		.sort((a, b) => a.slug.localeCompare(b.slug));

	return {
		spaces: list,
		user,
		// Two-variant empty copy (spec §13).
		emptyState:
			visible.length === 0
				? allEntries.length === 0
					? ('no-spaces-loaded' as const)
					: ('no-memberships' as const)
				: null
	};
}) satisfies PageServerLoad;
