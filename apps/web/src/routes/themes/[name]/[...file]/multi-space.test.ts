/**
 * Architectural regression: the theme asset route must delegate "which space?"
 * to the per-request `event.locals.space` set by `hooks.server.ts`, rather
 * than hardcoding a path or assuming a specific space. v0.5 subsystem 3
 * makes "which space?" a per-request decision; this route shouldn't need to
 * change as the resolver evolves — it consumes `space.root` and resolves
 * `<root>/themes/<name>/<file>`.
 *
 * Property under test: with two hypothetical spaces that each contain a
 * theme named `amber-default`, the route serves the bytes from whichever
 * space `event.locals.space` reports. Same URL → different content, gated
 * only by what the hook resolved.
 *
 * Companion to `server.test.ts`, which exercises a single fixture space;
 * this file constructs two stub-space objects and swaps them on the event,
 * so the test isn't sensitive to the process-global `getSpace()` singleton.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

const call = (name: string, file: string, root: string) =>
	GET({
		params: { name, file },
		url: new URL(`http://localhost/themes/${name}/${file}`),
		locals: { space: { root } }
	} as unknown as Parameters<typeof GET>[0]);

describe('theme asset route — per-space resolution', () => {
	test('same theme name resolves to space A bytes when locals.space points to space A', async () => {
		const res = await call('amber-default', 'theme.css', spaceA);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe(':root{--from:"A"}');
	});

	test('same theme name resolves to space B bytes when locals.space points to space B', async () => {
		const res = await call('amber-default', 'theme.css', spaceB);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe(':root{--from:"B"}');
	});

	test('containment guard is enforced against the active space, not a global root', async () => {
		// The path-traversal check is rooted at `<active-space>/themes/<name>/`.
		// An escape attempt out of the caller's space can't slip into a sibling
		// space's themes/ via `..` — same guard, same rooting, just a different
		// active root.
		const res = await call('amber-default', '../../../themes/amber-default/theme.css', spaceA);
		expect(res.status).toBe(404);
	});
});
