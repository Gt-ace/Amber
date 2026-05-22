/**
 * The `reroute` hook (spec §3.2). Runs on every request before route matching.
 *
 * In subsystem 3's first slice (the "spike") this is a no-op: the in-process
 * resolver is degenerate (single-space, no prefixes) so `mountPath` always
 * equals `pathname`. The seam exists so subsequent slices can light up
 * prefix-stripped routing without touching this file.
 *
 * `reroute` runs in **all** runtimes (including the universal/edge runtime),
 * so this file must stay free of node-only imports. The actual decision is
 * made in `hooks.server.ts`; this hook only rewrites the URL when a non-
 * trivial prefix would otherwise hide the route.
 */

import type { Reroute } from '@sveltejs/kit';

export const reroute: Reroute = ({ url }) => {
	// Subsequent slices will recompute the resolver decision against (event-
	// equivalent) URL/host and return the stripped pathname for `kind: 'space'`
	// results with non-empty prefix mounts. The spike is a no-op.
	void url;
	return undefined;
};
