/**
 * Install-level shared themes (spec §4).
 *
 * The three canonical themes ship *with the app*, not inside any content space,
 * so they are available to every space out of the box — new spaces included.
 * This module resolves where they live on disk and discovers them once at
 * install scope, reusing the pure `discoverThemes`. The result is merged into
 * each space's effective theme map by the registry (`lib/server/space.ts`).
 *
 * Directory resolution:
 *   - `AMBER_BUNDLED_THEMES_DIR` when set. The Dockerfile sets it to
 *     `/app/build/themes` (the build copies `apps/web/themes/` there); tests set
 *     it via `vitest.setup.ts`. In the built server it is always set, so the
 *     dev fallback below never runs there.
 *   - otherwise the in-repo source dir `apps/web/themes/`, derived from this
 *     module's own location (reliable in `vite dev`, where modules run from
 *     source).
 *
 * Discovered once and memoized; `themes/` is not watched (restart to pick up a
 * new shared theme dir), matching the per-space rule. The bundled dir on disk is
 * the truth for the shared set; nothing is persisted to `cache.db`.
 */

import { fileURLToPath } from 'node:url';
import { discoverThemesInDir } from '$lib/space/themes';
import { logger } from './logger';
import type { Theme } from '$lib/types/schema';

const log = logger.child({ subsystem: 'shared-themes' });

export function sharedThemesDir(): string {
	const env = process.env.AMBER_BUNDLED_THEMES_DIR;
	if (env) return env;
	return fileURLToPath(new URL('../../../themes/', import.meta.url));
}

let cached: Map<string, Theme> | null = null;

export function getSharedThemes(): Map<string, Theme> {
	if (cached === null) {
		const dir = sharedThemesDir();
		cached = discoverThemesInDir(dir, log);
		log.info({ dir, themes: [...cached.keys()] }, 'shared themes discovered');
	}
	return cached;
}

/** Test-only: clear the memoized set so the next `getSharedThemes()` re-discovers. */
export function __resetSharedThemesForTests(): void {
	cached = null;
}
