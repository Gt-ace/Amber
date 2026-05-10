/**
 * Tests for the catch-all page handler and the root layout server load.
 *
 * The page handler and layout both call `getSpace()`, which reads
 * `AMBER_SPACE_PATH`. We point that at the example-space fixture, set the
 * env var before importing, and then exercise the loaders directly.
 *
 * Note: the `Space` singleton is process-wide. Tests in this file share it,
 * which is fine because the fixture is read-only and the tests are
 * read-only.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { error } from '@sveltejs/kit';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

let pageLoad: typeof import('./+page.server.ts').load;
let layoutLoad: typeof import('../+layout.server.ts').load;

beforeAll(async () => {
	process.env.AMBER_SPACE_PATH = FIXTURE.replace(/\/$/, '');
	// Imports are deferred so the env var is set before `getSpace()` runs.
	const pageMod = await import('./+page.server.ts');
	const layoutMod = await import('../+layout.server.ts');
	pageLoad = pageMod.load;
	layoutLoad = layoutMod.load;
});

afterAll(async () => {
	// Best-effort: tear down the space singleton's watcher and SQLite handle
	// so Vitest doesn't hang on open file descriptors. The singleton doesn't
	// expose a reset, but `getSpace()` registers SIGTERM/SIGINT shutdown —
	// for tests we close it directly via the cached module.
	const serverSpace = await import('$lib/server/space');
	// `getSpace` returns the cached instance; close it.
	const sp = serverSpace.getSpace();
	sp.close();
});

// SvelteKit's `LoadEvent` carries many fields (`request`, `url`, `route`,
// `cookies`, etc.) but our handlers only read `params`. Cast through
// `unknown` so we can pass a minimal stub without listing every field.
const stubEvent = (params: Record<string, string>) =>
	({ params }) as unknown as Parameters<typeof pageLoad>[0];

const stubLayoutEvent = () =>
	({ params: {} }) as unknown as Parameters<typeof layoutLoad>[0];

describe('catch-all +page.server load', () => {
	test('throws 404 for an unknown URL', () => {
		// SvelteKit's `error(404, ...)` throws an `HttpError` synchronously.
		const call = () => pageLoad(stubEvent({ path: 'definitely-not-a-real-page-xyz' }));

		expect(call).toThrow();
		try {
			call();
		} catch (e) {
			// SvelteKit HttpError shape: { status, body: { message } }
			expect((e as { status: number }).status).toBe(404);
		}
	});

	test('returns page data for an existing URL', () => {
		const result = pageLoad(stubEvent({ path: 'about' })) as {
			page: { url: string; isDraft: boolean };
		};
		expect(result.page.url).toBe('/about');
		expect(result.page.isDraft).toBe(false);
	});

	test('issues a 308 for a URL present in space.redirects', async () => {
		// The example-space fixture's amber.toml maps `/old-portfolio` →
		// `/projects` in its `[redirects]` table. Hitting that URL must
		// raise SvelteKit's `Redirect` (status 308) before the page lookup.
		const serverSpace = await import('$lib/server/space');
		const sp = serverSpace.getSpace();
		expect(sp.redirects.get('/old-portfolio')).toBe('/projects');

		try {
			pageLoad(stubEvent({ path: 'old-portfolio' }));
			throw new Error('expected pageLoad to throw a redirect');
		} catch (e) {
			// SvelteKit's Redirect shape: { status, location }
			const r = e as { status?: number; location?: string };
			expect(r.status).toBe(308);
			expect(r.location).toBe('/projects');
		}
	});
});

describe('root +layout.server load', () => {
	test('returns nav + site as flat {label, href} entries', () => {
		const result = layoutLoad(stubLayoutEvent()) as {
			nav: Array<{ label: string; href: string }>;
			site: { title?: string } | null;
			notFoundHtml: string | null;
		};

		// Site comes through.
		expect(result.site?.title).toBe('Mira Halden');

		// Nav has entries (the fixture defines several valid ones plus one
		// malformed entry that the loader skips). Each entry is a flat
		// {label, href} object — no `kind`, no resolved `page` reference.
		expect(result.nav.length).toBeGreaterThan(0);
		for (const entry of result.nav) {
			expect(typeof entry.label).toBe('string');
			expect(typeof entry.href).toBe('string');
			expect(Object.keys(entry).sort()).toEqual(['href', 'label']);
		}

		// `notFoundHtml` is null because the fixture has no `404.md`.
		expect(result.notFoundHtml).toBeNull();
	});
});
