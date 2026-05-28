/**
 * Server-side Space registry.
 *
 * The runtime owns one `Space` per resolved filesystem path, lazily initialized
 * on first access. The registry itself is the process-global singleton: a
 * `Map<absPath, { space, watcher }>` keyed by the *absolute, normalised* path
 * of the space root. Two callers pointing at the same directory share a
 * `Space`; two callers pointing at different directories get distinct ones.
 *
 * `getSpace()` with no argument resolves to `AMBER_SPACE_PATH` — the v0.4
 * default-space path. This keeps every existing single-space caller working
 * unmodified. `getSpace(spacePath)` is the explicit form v0.5 routing will
 * use once requests resolve to a space root before reaching handlers.
 *
 * `hooks.server.ts` calls `getSpace()` once at startup so a missing or
 * unreadable space surfaces immediately, not on the first request.
 *
 * Shutdown handlers register once for the registry, not per space. On
 * `SIGTERM`/`SIGINT` we iterate every entry, close every watcher, close every
 * `Space`.
 *
 * This file is *runtime wiring* — it lives under `lib/server/`, not
 * `lib/space/`, because the pure space module must stay free of process
 * globals, env reads, and signal handlers.
 */

import path from 'node:path';
import { Space } from '$lib/space/space';
import { SpaceWatcher } from '$lib/space/watcher';
import { logger } from './logger';

const log = logger.child({ subsystem: 'server' });

interface Entry {
	space: Space;
	watcher: SpaceWatcher;
}

const registry = new Map<string, Entry>();
let shutdownRegistered = false;

function loadEntry(spacePath: string): Entry {
	log.info({ path: spacePath }, 'space singleton init');
	const { space, warnings } = Space.load(spacePath);
	if (warnings.length) {
		for (const w of warnings) {
			log.warn({ code: w.code, source: w.source }, w.message);
		}
	}

	const watcher = new SpaceWatcher(space);
	log.info({ root: space.root }, 'watcher started');
	// Don't await ready() — the initial index is already populated by load().
	// The watcher only matters for subsequent edits.

	return { space, watcher };
}

function registerShutdown(): void {
	if (shutdownRegistered) return;
	shutdownRegistered = true;
	const shutdown = async (signal: string) => {
		log.info({ signal, spaces: registry.size }, 'shutdown signal received');
		for (const [key, entry] of registry) {
			try {
				await entry.watcher.close();
			} catch (err) {
				log.warn({ err, key }, 'watcher close failed');
			}
			entry.space.close();
		}
		registry.clear();
	};
	// `once` keeps Vite HMR re-evaluations from stacking duplicate handlers
	// across module reloads.
	process.once('SIGTERM', () => shutdown('SIGTERM'));
	process.once('SIGINT', () => shutdown('SIGINT'));
}

export function getSpace(spacePath?: string): Space {
	let key: string;
	if (spacePath === undefined) {
		const env = process.env.AMBER_SPACE_PATH;
		if (!env) {
			throw new Error(
				'AMBER_SPACE_PATH is not set. Point it at your Amber space directory ' +
					'(e.g. AMBER_SPACE_PATH=apps/web/fixtures/example-space) and retry.'
			);
		}
		key = path.resolve(env);
	} else {
		key = path.resolve(spacePath);
	}

	const existing = registry.get(key);
	if (existing) return existing.space;

	const entry = loadEntry(key);
	registry.set(key, entry);
	registerShutdown();
	return entry.space;
}

/**
 * Enumerate every space currently in the registry. Used at boot by
 * `hooks.server.ts` to construct the resolver index after the spaces dir
 * has been scanned. Returns absolute path + Space pairs.
 */
export function getRegistryEntries(): Array<{ path: string; space: Space }> {
	return [...registry.entries()].map(([p, e]) => ({ path: p, space: e.space }));
}

/**
 * Test-only escape hatch. Closes every entry's watcher and Space, then clears
 * the registry so the next `getSpace()` call rehydrates from disk. Intended
 * for use in test `beforeEach`/`afterEach` so `Space` instances and watcher
 * file descriptors don't leak across cases. Not API — the `__` prefix is the
 * signal.
 */
export async function __resetRegistryForTests(): Promise<void> {
	for (const [, entry] of registry) {
		try {
			await entry.watcher.close();
		} catch {
			// Ignore — tests may have already torn down filesystem state.
		}
		try {
			entry.space.close();
		} catch {
			// Same — best-effort cleanup.
		}
	}
	registry.clear();
}

/**
 * Which discovery mode the runtime is in. Mirrors the mutual-exclusion
 * check in `hooks.server.ts:bootRegistry()` — exactly one of
 * AMBER_SPACE_PATH (single-space, v0.4 default) or AMBER_SPACES_DIR
 * (multi-space, v0.5 subsystem 3) must be set. Boot already throws if
 * the env is misconfigured, so a misconfigured runtime can never reach
 * a request handler that calls this. The duplicate check here is
 * defensive — anything calling this from test setup gets the same
 * shape of error rather than a silent default.
 *
 * Consumed by v0.5 subsystem 5's `/admin/new-space` (404s in
 * single-space mode) and the picker chrome (hides the New space
 * affordance in single-space mode).
 */
export function getDiscoveryMode(): 'single-space' | 'multi-space' {
	const single = !!process.env.AMBER_SPACE_PATH;
	const multi = !!process.env.AMBER_SPACES_DIR;
	if (single && multi) {
		throw new Error('both AMBER_SPACE_PATH and AMBER_SPACES_DIR are set');
	}
	if (!single && !multi) {
		throw new Error('neither AMBER_SPACE_PATH nor AMBER_SPACES_DIR is set');
	}
	return single ? 'single-space' : 'multi-space';
}
