import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

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
}

export function teardown() {
	rmSync(FIXTURE_AMBER, { recursive: true, force: true });
}
