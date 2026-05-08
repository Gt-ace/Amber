import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const FIXTURE_AMBER = fileURLToPath(
	new URL('./fixtures/example-space/.amber/', import.meta.url)
);

export function setup() {
	rmSync(FIXTURE_AMBER, { recursive: true, force: true });
}

export function teardown() {
	rmSync(FIXTURE_AMBER, { recursive: true, force: true });
}
