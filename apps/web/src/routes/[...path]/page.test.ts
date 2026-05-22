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

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

let pageLoad: typeof import('./+page.server.ts').load;
let layoutLoad: typeof import('../+layout.server.ts').load;
// Cached resolved space — populated in beforeAll, then injected into every
// stub event's `locals.space` (mirroring what `hooks.server.ts` does at
// runtime, since direct unit tests of route handlers bypass the hook).
let testSpace: import('$lib/space/space').Space;

beforeAll(async () => {
	process.env.AMBER_SPACE_PATH = FIXTURE.replace(/\/$/, '');
	// Imports are deferred so the env var is set before `getSpace()` runs.
	const pageMod = await import('./+page.server.ts');
	const layoutMod = await import('../+layout.server.ts');
	pageLoad = pageMod.load;
	layoutLoad = layoutMod.load;
	testSpace = (await import('$lib/server/space')).getSpace();
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
// `cookies`, etc.) but our handlers only read `params` and `locals`. Cast
// through `unknown` so we can pass a minimal stub without listing every
// field. v0.5 subsystem 3 threads the resolved Space through
// `event.locals.space`, which `hooks.server.ts` populates in production —
// tests reach into the process-global singleton to mirror that.
const stubEvent = (
	params: Record<string, string>,
	user: { id: string; email: string; name?: string | null; isInstallAdmin: boolean } | null = null,
	mountPrefix: string = ''
) =>
	({
		params,
		locals: { user, space: testSpace, mountPrefix }
	}) as unknown as Parameters<typeof pageLoad>[0];

const stubLayoutEvent = () =>
	({
		params: {},
		url: new URL('http://localhost/'),
		locals: { space: testSpace }
	}) as unknown as Parameters<typeof layoutLoad>[0];

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

	test('redirect target is remounted under the active prefix', () => {
		// For a prefix-mounted space, the manifest redirect target stays
		// space-relative on disk — the handler must prepend the mount prefix
		// so `/old-portfolio` → `/projects` lands at `/scratch/projects`,
		// not the default space's `/projects`. v0.5 subsystem 3 followup #10.
		try {
			pageLoad(stubEvent({ path: 'old-portfolio' }, null, '/scratch'));
			throw new Error('expected pageLoad to throw a redirect');
		} catch (e) {
			const r = e as { status?: number; location?: string };
			expect(r.status).toBe(308);
			expect(r.location).toBe('/scratch/projects');
		}
	});

	test('returns bodyHtml rendered through the active theme', () => {
		const result = pageLoad(stubEvent({ path: 'about' })) as {
			bodyHtml: string;
			page: { html: string };
		};
		expect(typeof result.bodyHtml).toBe('string');
		// The page template wraps the rendered markdown in <article>…<div class="article-body">…
		expect(result.bodyHtml).toContain('<article>');
		expect(result.bodyHtml).toContain('class="article-body"');
		expect(result.bodyHtml).toContain(result.page.html);
	});

	test('renders an auto_index list for /projects (the fixture page that declares it)', () => {
		const result = pageLoad(stubEvent({ path: 'projects' })) as { bodyHtml: string };
		expect(result.bodyHtml).toContain('<ul class="amber-auto-index">');
		expect(result.bodyHtml).toContain('href="/projects/amber"');
		expect(result.bodyHtml).toContain('href="/projects/field-notes"');
		// self-exclusion: the host page's own URL is not an entry. (Its nav link
		// lives in chrome, which `bodyHtml` doesn't include — so this asserts the
		// list, not the nav.)
		expect(result.bodyHtml).not.toContain('href="/projects"');
		// the host's own markdown body still renders, above the list
		expect(result.bodyHtml).toContain('A short, current list.');
		expect(result.bodyHtml.indexOf('A short, current list.')).toBeLessThan(
			result.bodyHtml.indexOf('amber-auto-index')
		);
	});

	test('emits an editHref for install-admin, null for signed-out, anchored to active slug', async () => {
		// Signed-out: no editHref, canEdit false (no DB call needed — short-circuits on null user).
		const data1 = pageLoad(stubEvent({ path: 'about' }, null)) as {
			editHref: string | null;
			canEdit: boolean;
		};
		expect(data1.editHref).toBeNull();
		expect(data1.canEdit).toBe(false);

		// Install-admin: canEdit returns true before any DB lookup (short-circuits on isInstallAdmin).
		const admin = { id: 'u2', email: 'admin@x', isInstallAdmin: true };
		const data2 = pageLoad(stubEvent({ path: 'about' }, admin)) as {
			editHref: string | null;
			canEdit: boolean;
		};
		// The link is namespaced under the active space's slug — for the
		// fixture, the directory basename `example-space`. Without this, a
		// prefix-mounted space's link would silently land in the default space
		// (the v0.5 subsystem 3 followup #5 regression).
		expect(data2.canEdit).toBe(true);
		expect(data2.editHref).toBe('/admin/spaces/example-space/edit/about');
		// Root URL: `/` must produce `…/edit` (no trailing slash) — the
		// invariant the editor's `[...path]` resolver relies on.
		const data3 = pageLoad(stubEvent({ path: '' }, admin)) as { editHref: string | null };
		expect(data3.editHref).toBe('/admin/spaces/example-space/edit');
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

	test('exposes the chrome halves, error template, and theme head data', () => {
		const result = layoutLoad(stubLayoutEvent()) as {
			chromeBefore: string;
			chromeAfter: string;
			errorTemplate: string;
			themeCssHref: string | null;
			themeColor: { light?: string; dark?: string } | null;
		};
		// Chrome split around the content slot: <header>…</header> | <footer>…</footer>.
		// `<main>` is *not* in either half — the layout owns it and wraps the page
		// in it between the two halves, so each half stays a balanced fragment.
		expect(result.chromeBefore).toContain('<header');
		expect(result.chromeBefore).toContain('</header>');
		expect(result.chromeAfter).toContain('<footer');
		expect(result.chromeBefore).not.toContain('<main');
		expect(result.chromeAfter).not.toContain('<main');
		expect(result.chromeBefore + result.chromeAfter).not.toContain('amber:content');
		// The fixture resolves to the built-in theme (no usable themes/ dir):
		// no stylesheet link, no theme-color.
		expect(result.themeCssHref).toBeNull();
		expect(result.errorTemplate).toContain('{{status}}');
	});
});
