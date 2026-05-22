/**
 * Server hooks (spec §4, §6).
 *
 * Three responsibilities per request:
 *
 *   1. Initialize the Space singleton at startup so a misconfigured
 *      AMBER_SPACE_PATH (or unreadable space) fails the boot, not the first
 *      request. Initialize the auth singleton (and run better-auth's
 *      migrations) for the same reason.
 *   2. Resolve the session cookie once and populate `event.locals.user` /
 *      `event.locals.session`. The /admin chrome and the public render
 *      path's `isAuthor()` probe both read these — one resolution per
 *      request, not per call site.
 *   3. Route /api/auth/* through better-auth's handler. We delegate to
 *      `svelteKitHandler`, which calls our `resolve(event)` for everything
 *      that isn't an auth endpoint.
 *
 * Also emits a request_id + start/end log line for every request (unchanged
 * from before this subsystem).
 */

import type { Handle } from '@sveltejs/kit';
import { building } from '$app/environment';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { logger } from '$lib/server/logger';
import { getSpace } from '$lib/server/space';
import { getAuth } from '$lib/server/auth-config';
import { resolve as resolveRoute, type ResolverIndex } from '$lib/server/resolver';
import { discoverSpaces } from '$lib/server/spaces-dir';
import { readSpaceConfig } from '$lib/space/config';
import { parseSpaceRouting } from '$lib/server/space-routing';
import { buildResolverIndex, type LoadedSpace } from '$lib/server/resolver-index';
import { setReroutePrefixes } from '$lib/server/reroute-prefixes';
import type { Space } from '$lib/space/space';

const bootLog = logger.child({ subsystem: 'resolver' });

function adminHostFromPublicUrl(): string {
	const u = process.env.AMBER_PUBLIC_URL;
	if (!u) {
		throw new Error(
			'AMBER_PUBLIC_URL is required to derive the admin host. ' +
				'See lib/server/auth-config.ts for the canonical message.'
		);
	}
	return new URL(u).host;
}

function bootRegistry(): ResolverIndex<Space> {
	const adminHost = adminHostFromPublicUrl();
	const singleEnv = process.env.AMBER_SPACE_PATH;
	const multiEnv = process.env.AMBER_SPACES_DIR;

	if (singleEnv && multiEnv) {
		throw new Error(
			'AMBER_SPACE_PATH and AMBER_SPACES_DIR are both set. Pick one: ' +
				'AMBER_SPACE_PATH for single-space mode (v0.4 default), AMBER_SPACES_DIR ' +
				'for multi-space mode (v0.5 subsystem 3). Both together is ambiguous and ' +
				'the boot refuses to guess.'
		);
	}
	if (!singleEnv && !multiEnv) {
		throw new Error(
			'Set exactly one of AMBER_SPACE_PATH (single-space) or AMBER_SPACES_DIR ' +
				'(multi-space). Neither is set; Amber needs to know where its content lives.'
		);
	}

	if (singleEnv) {
		// Single-space mode: load the one space, ignore its `space.toml` routing
		// fields (spec §6), make it the default.
		const space = getSpace(singleEnv);
		const { config } = readSpaceConfig(space.root);
		if (config) {
			for (const field of ['host', 'prefix', 'default'] as const) {
				if (config[field] !== undefined) {
					bootLog.info(
						{ field },
						`single-space mode ignores space.toml \`${field}\`; set AMBER_SPACES_DIR to use multi-space routing`
					);
				}
			}
		}
		bootLog.info(
			{ spaces: 1, hosts: [] as string[], prefixes: [] as string[], default: 'default' },
			'resolver index built (single-space mode)'
		);
		return {
			adminHost,
			byHost: new Map(),
			prefixes: [],
			default: space
		};
	}

	// Multi-space mode: discover, load each space, parse routing, build index.
	const { entries, warnings: discoveryWarnings } = discoverSpaces(multiEnv!);
	for (const w of discoveryWarnings) {
		bootLog.warn({ code: w.code, source: w.source }, w.message);
	}

	const loaded: LoadedSpace[] = [];
	for (const entry of entries) {
		const space = getSpace(entry.absPath);
		const { config, warnings: cfgWarnings } = readSpaceConfig(space.root);
		for (const w of cfgWarnings) {
			bootLog.warn({ code: w.code, slug: entry.slug, source: w.source }, w.message);
		}
		const { routing, warnings: routingWarnings } = parseSpaceRouting(
			config ?? {},
			entry.slug,
			adminHost
		);
		for (const w of routingWarnings) {
			bootLog.warn({ code: w.code, slug: entry.slug, source: w.source }, w.message);
		}
		loaded.push({ slug: entry.slug, space, routing });
	}

	const { index, warnings: buildWarnings } = buildResolverIndex(loaded, adminHost);
	for (const w of buildWarnings) {
		bootLog.warn({ code: w.code, source: w.source }, w.message);
	}

	const defaultSlug = loaded.find((l) => l.space === index.default)?.slug ?? null;
	bootLog.info(
		{
			spaces: loaded.length,
			hosts: [...index.byHost.keys()],
			prefixes: index.prefixes.map((p) => p.prefix),
			default: defaultSlug
		},
		'resolver index built (multi-space mode)'
	);
	return index;
}

const resolverIndex = bootRegistry();
setReroutePrefixes(resolverIndex.prefixes.map((p) => p.prefix));

// Build the auth instance and run better-auth's migrations on first request.
// Doing this lazily (rather than via top-level `await`) avoids a Vite chunk
// ordering issue: with top-level await, the auth-config chunk re-enters
// itself through better-auth's dynamic import of the SQLite dialect before
// the chunk's own exports are bound, producing an `undefined is not a
// constructor` runtime error against `BunSqliteDialect`. Single-flight
// guard so concurrent first-requests share one migration run.
let authPromise: Promise<Awaited<ReturnType<typeof getAuth>>> | null = null;
function auth() {
	if (!authPromise) authPromise = getAuth();
	return authPromise;
}

function newRequestId(): string {
	return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

export const handle: Handle = async ({ event, resolve }) => {
	const request_id = newRequestId();
	const log = logger.child({ request_id });
	event.locals.log = log;
	event.locals.user = null;
	event.locals.session = null;
	event.locals.space = null;
	event.locals.mountPath = null;

	const method = event.request.method;
	const path = event.url.pathname;
	const start = performance.now();

	log.info({ method, path }, 'request start');

	let status = 500;
	try {
		// Two-URL contract with SvelteKit's `reroute` hook:
		//   - `event.url` is the **original** request URL. SvelteKit builds it from
		//     `request.url` once and never mutates it (see kit/src/runtime/server/
		//     respond.js: `const url = new URL(request.url)` is what lands on the
		//     event; reroute is handed a *copy*, and its return value goes into a
		//     separate `resolved_path` variable used only for route matching).
		//   - Downstream handlers (`+page.server.ts` params.path, etc.) reflect
		//     the rerouted/mounted path because the route matcher consumed
		//     `resolved_path`, not because `event.url` changed.
		// So the resolver here must run against `event.url` (the original) to
		// pick the prefix-owning space — exactly what we want.
		const decision = resolveRoute(
			resolverIndex,
			event.url.host,
			event.url.pathname,
			event.url.search
		);

		if (decision.kind === 'admin-elsewhere') {
			log.info({ host: event.url.host, path: event.url.pathname }, 'admin-elsewhere → redirect');
			status = 302;
			return Response.redirect(decision.redirectTo, 302);
		}
		if (decision.kind === 'not-found') {
			log.info({ host: event.url.host, path: event.url.pathname }, 'no space matched');
			status = 404;
			return new Response('Not Found', { status: 404 });
		}
		if (decision.kind === 'space') {
			event.locals.space = decision.space;
			event.locals.mountPath = decision.mountPath;
		}
		// kind === 'admin' falls through to the regular handler.

		try {
			const result = await (await auth()).api.getSession({ headers: event.request.headers });
			if (result?.user) {
				event.locals.user = {
					id: result.user.id,
					email: result.user.email,
					name: result.user.name
				};
				event.locals.session = {
					id: result.session.id,
					userId: result.session.userId,
					expiresAt: new Date(result.session.expiresAt)
				};
			}
		} catch (e) {
			// A bad/expired cookie just means "no session"; the better-auth
			// handler will clean up downstream.
			log.debug({ err: (e as Error)?.message }, 'session resolve failed');
		}

		const response = await svelteKitHandler({ auth: await auth(), event, resolve, building });
		status = response.status;
		return response;
	} finally {
		const duration_ms = Math.round(performance.now() - start);
		log.info({ method, path, status, duration_ms }, 'request end');
	}
};
