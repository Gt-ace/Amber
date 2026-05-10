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
let _filterDraftsFromNav: typeof import('../+layout.server.ts')._filterDraftsFromNav;

beforeAll(async () => {
	process.env.AMBER_SPACE_PATH = FIXTURE.replace(/\/$/, '');
	// Imports are deferred so the env var is set before `getSpace()` runs.
	const pageMod = await import('./+page.server.ts');
	const layoutMod = await import('../+layout.server.ts');
	pageLoad = pageMod.load;
	layoutLoad = layoutMod.load;
	_filterDraftsFromNav = layoutMod._filterDraftsFromNav;
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
	test('returns nav + site, with drafts filtered out', () => {
		const result = layoutLoad(stubLayoutEvent()) as {
			nav: Array<{ kind: string; label: string; url?: string }>;
			site: { title?: string } | null;
			notFoundHtml: string | null;
		};

		// Site comes through.
		expect(result.site?.title).toBe('Mira Halden');

		// Nav has entries (the fixture defines several).
		expect(result.nav.length).toBeGreaterThan(0);

		// No nav entry resolves to a draft Page. The example-space fixture
		// has no draft in nav at present — this assertion guards future
		// fixture changes (and is the contract the layout promises).
		for (const entry of result.nav) {
			if (entry.kind === 'page') {
				const e = entry as unknown as { page: { frontmatter: { draft?: boolean } } };
				expect(e.page.frontmatter.draft).not.toBe(true);
			}
		}

		// `notFoundHtml` is null because the fixture has no `404.md`.
		expect(result.notFoundHtml).toBeNull();
	});
});

describe('_filterDraftsFromNav', () => {
	test('drops page entries marked draft, keeps externals and groups', () => {
		const fakePage = (draft: boolean) => ({
			filePath: '/abs/x.md',
			url: '/x',
			relativePath: 'x.md',
			frontmatter: { draft },
			extra: {},
			body: '',
			mtime: 0,
			contentHash: ''
		});
		const input: import('$lib/types/schema').ResolvedNavEntry[] = [
			{ kind: 'page', label: 'Live', url: '/live', page: fakePage(false) },
			{ kind: 'page', label: 'Hidden', url: '/hidden', page: fakePage(true) },
			{ kind: 'external', label: 'External', url: 'https://example.com' },
			{
				kind: 'group',
				label: 'Group',
				children: [
					{ kind: 'page', label: 'C1', url: '/c1', page: fakePage(false) },
					{ kind: 'page', label: 'C2', url: '/c2', page: fakePage(true) }
				]
			}
		];
		const out = _filterDraftsFromNav(input);
		expect(out.length).toBe(3); // /live, external, group
		expect(out[0].label).toBe('Live');
		expect(out[1].label).toBe('External');
		expect(out[2].kind).toBe('group');
		// Group's draft child is filtered out.
		const group = out[2] as Extract<(typeof out)[number], { kind: 'group' }>;
		expect(group.children.map((c) => c.label)).toEqual(['C1']);
	});
});
