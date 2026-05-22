/**
 * Resolves the [slug] route parameter to a `Space` via the registry and
 * enforces the per-space scope guard (spec §3, §6). After this layout runs,
 * child routes can read `event.locals.role` for fine-grained branching
 * (owner-only members page, etc.).
 */

import { error } from '@sveltejs/kit';
import path from 'node:path';
import type { LayoutServerLoad } from './$types';
import { getRegistryEntries } from '$lib/server/space';
import { requireSpaceAccess } from '$lib/server/permissions';

export const load: LayoutServerLoad = (event) => {
	const entries = getRegistryEntries();
	const match = entries.find((e) => path.basename(e.path) === event.params.slug);
	if (!match) error(404, `no space with slug "${event.params.slug}"`);

	event.locals.space = match.space;
	event.locals.mountPath = null;

	// Spec §3 — install-admin short-circuits; member returns their role;
	// non-member-of-an-existing-slug 404s (same status as unknown-slug above,
	// by deliberate disclosure choice).
	requireSpaceAccess(event, event.params.slug);

	return {
		slug: event.params.slug,
		spaceTitle: match.space.manifest.site?.title ?? event.params.slug,
		role: event.locals.role
	};
};
