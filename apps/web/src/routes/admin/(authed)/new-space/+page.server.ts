/**
 * /admin/new-space (v0.5 subsystem 5).
 *
 * Install-admin only — non-admins get 403 from the load. Hidden in
 * single-space mode — the load returns 404 so the route is invisible
 * to single-space operators. The form action validates server-side,
 * writes the directory tree, hot-adds the new space to the registry,
 * and redirects to /admin/spaces/<slug>. If the hot-add fails (corrupt
 * just-written files — should be impossible), the writer's output is
 * rolled back so the next attempt isn't blocked by a slug-collision.
 */

import { error, fail, redirect } from '@sveltejs/kit';
import { readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import type { Actions, PageServerLoad } from './$types';
import { logger } from '$lib/server/logger';
import { addSpace, getDiscoveryMode, getRegistryEntries } from '$lib/server/space';
import { getResolverIndex } from '$lib/server/resolver-index-holder';
import { createSpace } from '$lib/server/space-create';
import {
	validateCreateInput,
	type RoutingKind,
	type RegistrySnapshot
} from '$lib/server/space-create-validate';

const log = logger.child({ subsystem: 'space-create' });

function gateOrThrow(locals: App.Locals): void {
	if (getDiscoveryMode() === 'single-space') throw error(404, 'Not Found');
	if (!locals.user) throw error(401, 'Unauthorized'); // belt; (authed) layout already redirects
	if (!locals.user.isInstallAdmin) throw error(403, 'Install-admin only');
}

function buildSnapshot(): RegistrySnapshot {
	const idx = getResolverIndex();
	const entries = getRegistryEntries();
	// Build a Space → slug lookup once so the per-(host, prefix, default)
	// reverse lookups don't scan `entries` linearly each time.
	const spaceToSlug = new Map<unknown, string>(
		entries.map((e) => [e.space, path.basename(e.path)])
	);
	const hosts = new Map<string, string>();
	for (const [host, space] of idx.byHost) {
		const slug = spaceToSlug.get(space);
		if (slug) hosts.set(host, slug);
	}
	const prefixes = new Map<string, string>();
	for (const { prefix, space } of idx.prefixes) {
		const slug = spaceToSlug.get(space);
		if (slug) prefixes.set(prefix, slug);
	}
	const defaultOwner = idx.default ? (spaceToSlug.get(idx.default) ?? null) : null;
	// Slugs already on disk under AMBER_SPACES_DIR. Includes spaces that
	// failed to load (e.g. invalid slug regex) — we don't want to silently
	// re-mkdir over them.
	const parent = process.env.AMBER_SPACES_DIR!;
	let onDisk: string[] = [];
	try {
		onDisk = readdirSync(parent);
	} catch {
		// parent unreadable — treat as no slugs on disk (onDisk stays [])
	}
	return {
		slugs: new Set(onDisk),
		hosts,
		prefixes,
		defaultOwner,
		adminHost: idx.adminHost
	};
}

export const load: PageServerLoad = async (event) => {
	gateOrThrow(event.locals);
	const snap = buildSnapshot();
	const idx = getResolverIndex();
	return {
		discoveryMode: 'multi-space' as const,
		defaultOwner: snap.defaultOwner,
		// Exposed for the form's URL preview affordance — admin host +
		// scheme are the natural "this space will serve …" template
		// inputs (spec §11 follow-up).
		adminHost: idx.adminHost,
		adminScheme: idx.adminScheme
	};
};

export const actions: Actions = {
	default: async (event) => {
		gateOrThrow(event.locals);

		const fd = await event.request.formData();
		const raw = {
			title: String(fd.get('title') ?? ''),
			slug: String(fd.get('slug') ?? ''),
			routingKind: String(fd.get('routingKind') ?? 'admin-only') as RoutingKind,
			host: String(fd.get('host') ?? ''),
			prefix: String(fd.get('prefix') ?? '')
		};

		const snap = buildSnapshot();
		const { valid, errors } = validateCreateInput(raw, snap);
		if (!valid) {
			log.warn(
				{ slug: raw.slug, code: errors[0]?.code, actor: event.locals.user?.id },
				'create-rejected'
			);
			return fail(400, { errors, raw });
		}

		const start = performance.now();
		log.info(
			{ slug: valid.slug, routingKind: valid.routing.kind, actor: event.locals.user?.id },
			'create-attempted'
		);

		const parent = process.env.AMBER_SPACES_DIR!;
		const writeRes = await createSpace({ parentDir: parent, input: valid });
		if (writeRes.kind === 'error') {
			log.error(
				{ slug: valid.slug, code: writeRes.code, detail: writeRes.detail },
				'create-failed'
			);
			return fail(500, { writeError: writeRes.code, raw });
		}

		// writeRes is now narrowed to { kind: 'ok'; absPath: string } by the
		// discriminated union — no non-null assertion needed.
		try {
			await addSpace(writeRes.absPath);
		} catch (err) {
			log.error({ slug: valid.slug, err: (err as Error)?.message }, 'addSpace-failed-after-write');
			try {
				rmSync(writeRes.absPath, { recursive: true, force: true });
			} catch {
				/* best-effort */
			}
			return fail(500, { writeError: 'write_failed', raw });
		}

		const durationMs = Math.round(performance.now() - start);
		log.info(
			{ slug: valid.slug, absPath: writeRes.absPath, routingKind: valid.routing.kind, durationMs },
			'create-succeeded'
		);

		throw redirect(302, `/admin/spaces/${valid.slug}`);
	}
};
