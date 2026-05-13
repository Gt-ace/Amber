/**
 * Architectural regression: the theme asset route must delegate "which space?"
 * to the `getSpace()` abstraction rather than hardcoding a path or assuming a
 * specific space. v0.1 ships a single-space `getSpace()` singleton; v0.4 will
 * key it per-request. This route shouldn't need to change in either world —
 * it consumes `space.root` and resolves `<root>/themes/<name>/<file>`.
 *
 * Property under test: with two hypothetical spaces that each contain a
 * theme named `amber-default`, the route serves the bytes from whichever
 * space the abstraction returns. Same URL → different content, gated only by
 * what `getSpace()` reports.
 *
 * Companion to `server.test.ts`, which exercises the real (single-space)
 * `getSpace()` against a fixture; this file mocks the import so the test
 * isn't sensitive to v0.1's process-global singleton.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const getSpaceMock = vi.fn();
vi.mock('$lib/server/space', () => ({ getSpace: getSpaceMock }));

let GET: typeof import('./+server.ts').GET;
let spaceA: string;
let spaceB: string;

beforeAll(async () => {
	spaceA = mkdtempSync(join(tmpdir(), 'amber-space-a-'));
	spaceB = mkdtempSync(join(tmpdir(), 'amber-space-b-'));
	mkdirSync(join(spaceA, 'themes', 'amber-default'), { recursive: true });
	mkdirSync(join(spaceB, 'themes', 'amber-default'), { recursive: true });
	writeFileSync(join(spaceA, 'themes', 'amber-default', 'theme.css'), ':root{--from:"A"}');
	writeFileSync(join(spaceB, 'themes', 'amber-default', 'theme.css'), ':root{--from:"B"}');
	GET = (await import('./+server.ts')).GET;
});

afterAll(() => {
	rmSync(spaceA, { recursive: true, force: true });
	rmSync(spaceB, { recursive: true, force: true });
});

beforeEach(() => {
	getSpaceMock.mockReset();
});

const call = (name: string, file: string) =>
	GET({ params: { name, file } } as unknown as Parameters<typeof GET>[0]);

describe('theme asset route — per-space resolution', () => {
	test('same theme name resolves to space A bytes when getSpace() returns space A', async () => {
		getSpaceMock.mockReturnValue({ root: spaceA });
		const res = await call('amber-default', 'theme.css');
		expect(res.status).toBe(200);
		expect(await res.text()).toBe(':root{--from:"A"}');
	});

	test('same theme name resolves to space B bytes when getSpace() returns space B', async () => {
		getSpaceMock.mockReturnValue({ root: spaceB });
		const res = await call('amber-default', 'theme.css');
		expect(res.status).toBe(200);
		expect(await res.text()).toBe(':root{--from:"B"}');
	});

	test('containment guard is enforced against the active space, not a global root', async () => {
		// The path-traversal check is rooted at `<active-space>/themes/<name>/`.
		// Once `getSpace()` becomes per-request, an escape attempt out of the
		// caller's space can't slip into a sibling space's themes/ via `..`
		// — same guard, same rooting, just a different active root.
		getSpaceMock.mockReturnValue({ root: spaceA });
		const res = await call('amber-default', '../../../themes/amber-default/theme.css');
		expect(res.status).toBe(404);
	});
});
