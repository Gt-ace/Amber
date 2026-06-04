import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const FIXTURE_AMBER = fileURLToPath(new URL('./fixtures/example-space/.amber/', import.meta.url));

export function setup() {
	rmSync(FIXTURE_AMBER, { recursive: true, force: true });
	// Tests that transitively import `auth-config.ts` need *some* secret to
	// be present at module-construction time. Real tests that exercise auth
	// behaviour build their own throwaway instance via `buildAuth({ dbPath })`
	// and don't rely on this default.
	if (!process.env.AMBER_AUTH_SECRET) {
		process.env.AMBER_AUTH_SECRET = 'test-secret-do-not-use-in-production';
	}
	if (!process.env.AMBER_PUBLIC_URL) {
		process.env.AMBER_PUBLIC_URL = 'http://localhost:3000';
	}
	// Shared themes (install-level) default to *empty* in tests: point the
	// bundled-themes dir at a path that does not exist so `discoverThemesInDir`
	// returns an empty map. Registry-path tests then see only per-space themes,
	// preserving exact-list assertions. Tests that exercise shared themes
	// override AMBER_BUNDLED_THEMES_DIR and call __resetSharedThemesForTests().
	if (!process.env.AMBER_BUNDLED_THEMES_DIR) {
		process.env.AMBER_BUNDLED_THEMES_DIR = join(tmpdir(), 'amber-test-no-shared-themes');
	}
}

export function teardown() {
	rmSync(FIXTURE_AMBER, { recursive: true, force: true });
}
