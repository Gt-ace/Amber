/**
 * The `reroute` hook (spec §3.2). Runs on every request before route matching
 * and runs in **all** runtimes — it must stay free of node-only imports.
 *
 * For a request whose pathname falls under a registered prefix (e.g.
 * `/scratch/post-1` with `/scratch` registered), we rewrite the pathname to
 * `/post-1` so SvelteKit's route matcher sees the mounted path. The full
 * resolver still runs in `hooks.server.ts` to set `event.locals.space`; this
 * hook only does the URL rewrite.
 *
 * The prefix list is populated by `hooks.server.ts` at boot via
 * `setReroutePrefixes()`. Storing it in a tiny shared module (rather than
 * importing the resolver here) keeps this file universal-runtime-safe.
 */

import type { Reroute } from '@sveltejs/kit';
import { reroutePrefixes } from '$lib/server/reroute-prefixes';

export const reroute: Reroute = ({ url }) => {
	for (const prefix of reroutePrefixes()) {
		if (url.pathname === prefix) {
			return '/';
		}
		if (url.pathname.startsWith(prefix + '/')) {
			return url.pathname.slice(prefix.length);
		}
	}
	return undefined;
};
