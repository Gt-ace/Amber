/**
 * Server-side Space singleton.
 *
 * The runtime owns one `Space` instance per process, lazily initialized on
 * first access. `getSpace()` reads `AMBER_SPACE_PATH`, calls `Space.load()`
 * (which hydrates from `.amber/cache.db` if available), starts the watcher,
 * and registers shutdown handlers so the SQLite connection closes cleanly
 * on `SIGTERM`/`SIGINT`.
 *
 * `hooks.server.ts` calls `getSpace()` once at startup so a missing or
 * unreadable space surfaces immediately, not on the first request.
 *
 * This file is *runtime wiring* — it lives under `lib/server/`, not
 * `lib/space/`, because the pure space module must stay free of process
 * globals, env reads, and signal handlers.
 */

import { Space } from '$lib/space/space';
import { SpaceWatcher } from '$lib/space/watcher';

let cached: Space | null = null;
let shutdownRegistered = false;

export function getSpace(): Space {
	if (cached) return cached;

	const path = process.env.AMBER_SPACE_PATH;
	if (!path) {
		throw new Error(
			'AMBER_SPACE_PATH is not set. Point it at your Amber space directory ' +
				'(e.g. AMBER_SPACE_PATH=apps/web/fixtures/example-space) and retry.'
		);
	}

	const { space, warnings } = Space.load(path);
	if (warnings.length) {
		for (const w of warnings) {
			console.warn(`[amber] load warning [${w.code}] ${w.source ?? ''} — ${w.message}`);
		}
	}

	const watcher = new SpaceWatcher(space);
	// Don't await ready() — the initial index is already populated by load().
	// The watcher only matters for subsequent edits.

	if (!shutdownRegistered) {
		shutdownRegistered = true;
		const shutdown = async () => {
			try {
				await watcher.close();
			} catch (err) {
				console.warn('[amber] watcher close failed:', err);
			}
			space.close();
		};
		// `once` keeps Vite HMR re-evaluations from stacking duplicate
		// handlers across module reloads.
		process.once('SIGTERM', shutdown);
		process.once('SIGINT', shutdown);
	}

	cached = space;
	return space;
}
