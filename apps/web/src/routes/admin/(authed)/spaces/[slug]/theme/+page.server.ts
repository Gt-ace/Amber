/**
 * /admin/spaces/[slug]/theme — owner-or-install-admin theme picker
 * (v0.5 subsystem 6).
 *
 * GET builds the picker shape from the live discovered theme set + the space's
 * current space.toml. POST validates the submitted theme against that set,
 * canonically rewrites space.toml's `theme` field (preserving routing), and
 * 303-redirects. The watcher hot-reloads the active theme — no restart.
 *
 * The [slug] layout above has already run `requireSpaceAccess(event, slug)`
 * (no minimumRole), so a non-member / unknown slug was 404'd before this load
 * runs. This route upgrades the floor to 'owner' — which 403s an editor of
 * this space. install-admin bypasses both.
 */

import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { requireSpaceAccess } from '$lib/server/permissions';
import { getDiscoveryMode } from '$lib/server/space';
import { readSpaceConfig } from '$lib/space/config';
import { describeThemeSource } from '$lib/space/themes';
import { publicUrlForSpace } from '$lib/server/space-routing';
import { validateThemePick } from '$lib/server/space-config-validate';
import { writeSpaceConfig, type SpaceConfigUpdate } from '$lib/server/space-config-write';
import { logger } from '$lib/server/logger';

const log = logger.child({ subsystem: 'theme-picker' });

/** The routing fields to round-trip into the write, from the live config. */
function preservedRouting(
	config: { host?: string; prefix?: string; default?: boolean } | null
): SpaceConfigUpdate {
	if (!config) return {};
	if (typeof config.host === 'string' && config.host.length > 0) return { host: config.host };
	if (typeof config.prefix === 'string' && config.prefix.length > 0) return { prefix: config.prefix };
	if (config.default === true) return { default: true };
	return {};
}

export const load: PageServerLoad = async (event) => {
	requireSpaceAccess(event, event.params.slug, 'owner');
	const space = event.locals.space;
	if (!space) throw new Error('locals.space not set by [slug]/+layout.server.ts');

	const { config } = readSpaceConfig(space.root);
	const declaredTheme = config?.theme;
	const resolvedThemeName = space.theme.name;
	const { source, staleThemeName } = describeThemeSource(declaredTheme, space.themes);
	const publicUrl = publicUrlForSpace(
		config,
		process.env.AMBER_PUBLIC_URL!,
		getDiscoveryMode()
	);

	const themes = [...space.themes.values()]
		.map((t) => ({
			name: t.name,
			description: t.manifest.description ?? null,
			version: t.manifest.version ?? null,
			author: t.manifest.author ?? null
		}))
		.sort((a, b) => {
			if (a.name === 'amber-default') return -1;
			if (b.name === 'amber-default') return 1;
			return a.name.localeCompare(b.name);
		});

	return {
		slug: event.params.slug,
		themes,
		declaredTheme: declaredTheme ?? null,
		resolvedThemeName,
		themeSource: source,
		staleThemeName,
		publicUrl
	};
};

export const actions: Actions = {
	default: async (event) => {
		requireSpaceAccess(event, event.params.slug, 'owner');
		const space = event.locals.space;
		if (!space) throw new Error('locals.space not set by [slug]/+layout.server.ts');

		const fd = await event.request.formData();
		const submitted = String(fd.get('theme') ?? '');
		log.info(
			{
				slug: event.params.slug,
				themeSubmitted: submitted === '' ? null : submitted,
				actor: event.locals.user?.id
			},
			'pick-attempted'
		);

		const result = validateThemePick(submitted, space.themes);
		if (result.kind === 'error') {
			log.warn(
				{ slug: event.params.slug, code: result.code, themeSubmitted: submitted, actor: event.locals.user?.id },
				'pick-rejected'
			);
			return fail(400, { themeError: result.code, submitted });
		}

		const { config } = readSpaceConfig(space.root);
		const prevTheme = config?.theme ?? null;
		const update: SpaceConfigUpdate = {
			...preservedRouting(config),
			...(result.theme !== undefined ? { theme: result.theme } : {})
		};

		const start = performance.now();
		const writeRes = await writeSpaceConfig(space.root, update);
		if (writeRes.kind === 'error') {
			log.error(
				{ slug: event.params.slug, code: writeRes.code, detail: writeRes.detail, themeSubmitted: submitted },
				'pick-failed'
			);
			return fail(500, { writeError: writeRes.code });
		}

		const durationMs = Math.round(performance.now() - start);
		log.info(
			{ slug: event.params.slug, themeWritten: result.theme ?? null, prevTheme, durationMs },
			'pick-succeeded'
		);

		throw redirect(303, `/admin/spaces/${event.params.slug}/theme`);
	}
};
