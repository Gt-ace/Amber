import { describe, expect, test, beforeEach, afterEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load, LoadError, splitFrontmatter, coerceDate, resolveNav, buildPage } from './load.ts';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));
const INVALID = (name: string): string =>
	fileURLToPath(new URL(`../../../fixtures/invalid-spaces/${name}/`, import.meta.url));

describe('load(spacePath)', () => {
	test('parses the example-space fixture', () => {
		const { space, warnings } = load(FIXTURE);

		// Manifest is parsed end-to-end
		expect(space.manifest.amber_version).toBe('0.1');
		expect(space.manifest.site?.title).toBe('Mira Halden');
		expect(space.manifest.site?.language).toBe('en');

		// Page index — keys are leading-slash, no-trailing, "/" for root.
		expect([...space.pages.keys()].sort()).toEqual([
			'/',
			'/about',
			'/notes/2025-09-on-tea',
			'/notes/unfinished-essay',
			'/projects',
			'/projects/amber',
			'/projects/field-notes',
			'/say-hi'
		]);

		// Root index → "/"
		const root = space.pages.get('/')!;
		expect(root.relativePath).toBe('index.md');
		expect(root.frontmatter.title).toBe('Mira Halden');
		expect(root.body.trimStart().startsWith('I draw things')).toBe(true);
		// Frontmatter block is stripped from body
		expect(root.body.includes('title: Mira Halden')).toBe(false);

		// Folder-with-index → /projects (no trailing slash)
		const projects = space.pages.get('/projects')!;
		expect(projects.relativePath).toBe('projects/index.md');

		// Nested folder-with-index
		const fieldNotes = space.pages.get('/projects/field-notes')!;
		expect(fieldNotes.relativePath).toBe('projects/field-notes/index.md');

		// auto_index on projects/index.md is parsed and normalized (sort defaulted)
		expect(projects.frontmatter.auto_index).toEqual({ path: 'projects', sort: 'date desc' });

		// slug: replaces filename segment, not parents
		const sayHi = space.pages.get('/say-hi')!;
		expect(sayHi.relativePath).toBe('hello.md');
		expect(sayHi.frontmatter.slug).toBe('say-hi');

		// Drafts ARE in the index — consumers filter, loader produces.
		const draft = space.pages.get('/notes/unfinished-essay')!;
		expect(draft.frontmatter.draft).toBe(true);

		// Body is raw markdown — no HTML rendering
		expect(projects.body).toContain('![A pencil sketch');
		expect(projects.body).not.toContain('<img');

		// Reserved-prefix dirs are silently skipped (no Page entries, no warnings).
		expect(space.pages.has('/_drafts/scratch')).toBe(false);
		expect(space.pages.has('/_internal/note')).toBe(false);
		expect(space.pages.has('/.scratch/note')).toBe(false);
		// themes/ is reserved at the top level
		for (const k of space.pages.keys()) {
			expect(k.startsWith('/themes')).toBe(false);
		}

		// Non-markdown files are not in the page index
		for (const k of space.pages.keys()) {
			expect(k.endsWith('.png')).toBe(false);
		}

		// Frontmatter typed fields are parsed
		const onTea = space.pages.get('/notes/2025-09-on-tea')!;
		expect(onTea.frontmatter.tags).toEqual(['notes', 'habits']);
		expect(onTea.frontmatter.date).toBe('2025-09-14');
		expect(onTea.frontmatter.layout).toBe('post');

		// Each page has mtime + contentHash populated
		for (const p of space.pages.values()) {
			expect(typeof p.mtime).toBe('number');
			expect(p.mtime).toBeGreaterThan(0);
			expect(p.contentHash).toMatch(/^[0-9a-f]{64}$/);
			expect(p.filePath.endsWith(p.relativePath)).toBe(true);
		}

		// Validated nav: flat {label, href}, malformed entries dropped.
		// Fixture has 5 valid entries and one malformed (missing `href`).
		expect(space.nav).toEqual([
			{ label: 'About', href: '/about' },
			{ label: 'Projects', href: '/projects' },
			{ label: 'On tea', href: '/notes/2025-09-on-tea' },
			{ label: 'Mastodon', href: 'https://merveilles.town/@mira' },
			{ label: 'Say hi', href: '/say-hi' }
		]);

		// Redirects compiled into a Map, normalized form.
		expect(space.redirects.get('/old-portfolio')).toBe('/projects');
		expect(space.redirects.get('/blog')).toBe('/notes');

		// v0.2 nav resolution emits no LoadWarnings — malformed entries are
		// logged and skipped. The fixture has no other warning triggers, so
		// the warnings array is empty.
		expect(warnings).toEqual([]);

		// space.warnings mirrors the returned warnings array.
		expect(space.warnings).toEqual(warnings);

		// space.root is the resolved absolute path
		expect(space.root.length).toBeGreaterThan(0);
	});

	test('does not rewrite amber.toml on disk', () => {
		const manifestPath = fileURLToPath(new URL('amber.toml', new URL(FIXTURE, 'file://')));
		const before = readFileSync(manifestPath);
		load(FIXTURE);
		const after = readFileSync(manifestPath);
		expect(after.equals(before)).toBe(true);
	});
});

describe('load() — LoadError cases', () => {
	test('throws when amber.toml is missing', () => {
		expect.assertions(3);
		try {
			load(INVALID('missing-manifest'));
		} catch (err) {
			expect(err).toBeInstanceOf(LoadError);
			const e = err as LoadError;
			expect(e.source).toBe('amber.toml');
			expect(e.message).toMatch(/amber\.toml not found/);
		}
	});

	test('throws when amber.toml is unparseable TOML', () => {
		expect.assertions(3);
		try {
			load(INVALID('unparseable-manifest'));
		} catch (err) {
			expect(err).toBeInstanceOf(LoadError);
			const e = err as LoadError;
			expect(e.source).toBe('amber.toml');
			expect(e.message).toMatch(/failed to parse/);
		}
	});

	test('throws when amber_version is missing', () => {
		expect.assertions(3);
		try {
			load(INVALID('missing-amber-version'));
		} catch (err) {
			expect(err).toBeInstanceOf(LoadError);
			const e = err as LoadError;
			expect(e.source).toBe('amber.toml');
			expect(e.message).toMatch(/missing required `amber_version`/);
		}
	});

	test('throws when slug: is set on an index.md', () => {
		expect.assertions(3);
		try {
			load(INVALID('slug-on-index'));
		} catch (err) {
			expect(err).toBeInstanceOf(LoadError);
			const e = err as LoadError;
			// The source is the offending page's relative path.
			expect(e.source).toBe('folder/index.md');
			expect(e.message).toMatch(/slug.*index\.md.*incoherent/);
		}
	});
});

describe('coerceDate()', () => {
	test('valid ISO date string passes through (trimmed)', () => {
		expect(coerceDate('2026-05-10')).toEqual({ value: '2026-05-10' });
		expect(coerceDate('  2026-05-10  ')).toEqual({ value: '2026-05-10' });
		expect(coerceDate('2026-05-10T12:34:56Z')).toEqual({ value: '2026-05-10T12:34:56Z' });
	});

	test('YAML-native Date object becomes an ISO string', () => {
		const d = new Date('2026-05-10T00:00:00Z');
		const r = coerceDate(d);
		expect(r).toEqual({ value: '2026-05-10T00:00:00.000Z' });
	});

	test('Invalid Date object is rejected', () => {
		const d = new Date('not-a-date');
		const r = coerceDate(d);
		expect('error' in r).toBe(true);
	});

	test('invalid string date is rejected', () => {
		const r = coerceDate('not-a-date');
		expect('error' in r).toBe(true);
	});

	test('empty string is rejected', () => {
		const r = coerceDate('');
		expect('error' in r).toBe(true);
		const r2 = coerceDate('   ');
		expect('error' in r2).toBe(true);
	});

	test('integer is rejected', () => {
		const r = coerceDate(12345);
		expect('error' in r).toBe(true);
	});

	test('boolean and arrays are rejected', () => {
		expect('error' in coerceDate(true)).toBe(true);
		expect('error' in coerceDate(['2026-05-10'])).toBe(true);
		expect('error' in coerceDate({})).toBe(true);
	});
});

describe('splitFrontmatter() — `date`/`updated` validation', () => {
	test('valid ISO date string is preserved on the typed frontmatter', () => {
		const { frontmatter, fieldErrors } = splitFrontmatter('---\ndate: "2026-05-10"\n---\nbody\n');
		expect(frontmatter.date).toBe('2026-05-10');
		expect(fieldErrors).toEqual([]);
	});

	test('YAML-native bare date is normalized to a string (no warning)', () => {
		// The default `yaml` parser returns this as a string; this test pins
		// down that behavior. If the parser ever switches to returning a Date,
		// `coerceDate` still produces a string and the test still passes.
		const { frontmatter, fieldErrors } = splitFrontmatter('---\ndate: 2026-05-10\n---\nbody\n');
		expect(typeof frontmatter.date).toBe('string');
		expect(frontmatter.date).toMatch(/^2026-05-10/);
		expect(fieldErrors).toEqual([]);
	});

	test('missing date is undefined and produces no warning', () => {
		const { frontmatter, fieldErrors } = splitFrontmatter('---\ntitle: hi\n---\nbody\n');
		expect(frontmatter.date).toBeUndefined();
		expect(fieldErrors).toEqual([]);
	});

	test('invalid string date is dropped and reported in fieldErrors', () => {
		const { frontmatter, fieldErrors } = splitFrontmatter('---\ndate: not-a-date\n---\nbody\n');
		expect(frontmatter.date).toBeUndefined();
		expect(fieldErrors).toHaveLength(1);
		expect(fieldErrors[0]).toMatch(/`date`/);
	});

	test('empty string date is dropped and reported', () => {
		const { frontmatter, fieldErrors } = splitFrontmatter('---\ndate: ""\n---\nbody\n');
		expect(frontmatter.date).toBeUndefined();
		expect(fieldErrors).toHaveLength(1);
		expect(fieldErrors[0]).toMatch(/empty/);
	});

	test('integer date is dropped and reported', () => {
		const { frontmatter, fieldErrors } = splitFrontmatter('---\ndate: 12345\n---\nbody\n');
		expect(frontmatter.date).toBeUndefined();
		expect(fieldErrors).toHaveLength(1);
		expect(fieldErrors[0]).toMatch(/`date`/);
	});

	test('invalid `updated` is treated the same as invalid `date`', () => {
		const { frontmatter, fieldErrors } = splitFrontmatter('---\nupdated: not-a-date\n---\nbody\n');
		expect(frontmatter.updated).toBeUndefined();
		expect(fieldErrors).toHaveLength(1);
		expect(fieldErrors[0]).toMatch(/`updated`/);
	});

	test('an invalid date does not break other frontmatter fields', () => {
		const { frontmatter, fieldErrors } = splitFrontmatter(
			'---\ntitle: Hello\ndate: not-a-date\ntags: [a, b]\n---\nbody\n'
		);
		expect(frontmatter.title).toBe('Hello');
		expect(frontmatter.tags).toEqual(['a', 'b']);
		expect(frontmatter.date).toBeUndefined();
		expect(fieldErrors).toHaveLength(1);
	});

	test('both `date` and `updated` invalid → two field errors', () => {
		const { fieldErrors } = splitFrontmatter('---\ndate: 12345\nupdated: not-a-date\n---\nbody\n');
		expect(fieldErrors).toHaveLength(2);
	});
});

describe('resolveNav (v0.2 [[nav]] schema)', () => {
	test('passes valid {label, href} entries through unchanged', () => {
		const out = resolveNav([
			{ label: 'Home', href: '/' },
			{ label: 'Notes', href: '/notes' },
			{ label: 'Mastodon', href: 'https://example.social/@me' }
		]);
		expect(out).toEqual([
			{ label: 'Home', href: '/' },
			{ label: 'Notes', href: '/notes' },
			{ label: 'Mastodon', href: 'https://example.social/@me' }
		]);
	});

	test('returns an empty array when there is no [nav] table', () => {
		// `manifest.nav` is undefined when the [nav] table is absent. The
		// loader's `manifest.nav ? resolveNav(...) : []` short-circuits in
		// that case; a defensive direct call should still behave.
		expect(resolveNav(undefined)).toEqual([]);
	});

	test('skips entries missing required keys (label, href)', () => {
		const out = resolveNav([
			{ label: 'Good', href: '/good' },
			{ label: 'No href' }, // missing href → skipped
			{ href: '/no-label' }, // missing label → skipped
			{ label: 'Also good', href: '/also' }
		]);
		expect(out).toEqual([
			{ label: 'Good', href: '/good' },
			{ label: 'Also good', href: '/also' }
		]);
	});

	test('skips entries with non-string label or href', () => {
		const out = resolveNav([
			{ label: 'OK', href: '/ok' },
			{ label: 42, href: '/bad-label' }, // wrong-type label → skipped
			{ label: 'Bad href', href: ['/array'] } // wrong-type href → skipped
		]);
		expect(out).toEqual([{ label: 'OK', href: '/ok' }]);
	});

	test('ignores extra keys on a valid entry (forward-compat)', () => {
		const out = resolveNav([
			{ label: 'Home', href: '/', kind: 'page', icon: 'house', extra: { x: 1 } }
		]);
		expect(out).toEqual([{ label: 'Home', href: '/' }]);
	});

	test('skips non-table entries (strings, arrays, null) without throwing', () => {
		const out = resolveNav([
			'not-a-table',
			null,
			['array', 'entry'],
			{ label: 'Survivor', href: '/s' }
		]);
		expect(out).toEqual([{ label: 'Survivor', href: '/s' }]);
	});
});

describe('per-space theming via space.toml', () => {
	let scratch: string;

	beforeEach(() => {
		scratch = mkdtempSync(join(tmpdir(), 'amber-load-space-toml-'));
		writeFileSync(join(scratch, 'amber.toml'), 'amber_version = "0.2"\n');
		writeFileSync(join(scratch, 'index.md'), '# hi\n');
		mkdirSync(join(scratch, 'themes', 'theme-a'), { recursive: true });
		const themeFiles = {
			'theme.toml': 'name = "A"\nversion = "1"\n',
			'theme.css': ':root{}',
			'chrome.html': '<!--amber:content-->',
			'page.html': '{{{html}}}',
			'error.html': '<p>{{status}}</p>'
		} as const;
		for (const [f, c] of Object.entries(themeFiles)) {
			writeFileSync(join(scratch, 'themes', 'theme-a', f), c);
		}
	});

	afterEach(() => {
		rmSync(scratch, { recursive: true, force: true });
	});

	test('space.toml `theme` selects the theme', () => {
		writeFileSync(join(scratch, 'space.toml'), 'theme = "theme-a"\n');
		const { space, warnings } = load(scratch);
		expect(space.theme.name).toBe('theme-a');
		expect(warnings).toEqual([]);
	});

	test('invalid space.toml emits space_config_invalid and falls through', () => {
		writeFileSync(join(scratch, 'space.toml'), 'this = = not toml');
		const { space, warnings } = load(scratch);
		expect(warnings.some((w) => w.code === 'space_config_invalid')).toBe(true);
		// theme-a is the only discovered theme; no amber-default present so the
		// space falls through to the built-in floor. Important: space still loads.
		expect(space.theme).toBeDefined();
	});

	test('space.toml names a missing theme → space_theme_not_found, falls through', () => {
		writeFileSync(join(scratch, 'space.toml'), 'theme = "ghost"\n');
		const { space, warnings } = load(scratch);
		expect(warnings.some((w) => w.code === 'space_theme_not_found')).toBe(true);
		// No amber-default theme in this fixture either → built-in floor.
		expect(space.theme.path).toBe('');
	});
});

describe('buildPage — auto_index validation', () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'amber-buildpage-'));
		mkdirSync(join(root, 'writing'));
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	function write(rel: string, frontmatter: string): string {
		const p = join(root, rel);
		writeFileSync(p, `---\n${frontmatter}\n---\nbody\n`);
		return p;
	}

	test('valid auto_index is normalized onto the page; no warning', () => {
		const { page, warnings } = buildPage(
			root,
			write('feature.md', 'title: Feature\nauto_index:\n  path: writing\n  limit: 3')
		);
		expect(warnings).toEqual([]);
		expect(page.frontmatter.auto_index).toEqual({ path: 'writing', sort: 'date desc', limit: 3 });
	});

	test('missing directory → auto_index_path_missing warning (with source) and the directive is dropped', () => {
		const { page, warnings } = buildPage(root, write('feature.md', 'auto_index:\n  path: nope'));
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ code: 'auto_index_path_missing', source: 'feature.md' });
		expect(page.frontmatter.auto_index).toBeUndefined();
	});

	test('bad sort → auto_index_invalid_sort warning, directive dropped', () => {
		const { page, warnings } = buildPage(
			root,
			write('feature.md', 'auto_index:\n  path: writing\n  sort: newest')
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ code: 'auto_index_invalid_sort', source: 'feature.md' });
		expect(page.frontmatter.auto_index).toBeUndefined();
	});

	test('bad limit → auto_index_invalid_limit warning, directive dropped', () => {
		const { page, warnings } = buildPage(
			root,
			write('feature.md', 'auto_index:\n  path: writing\n  limit: 0')
		);
		expect(warnings).toHaveLength(1);
		expect(warnings[0]).toMatchObject({ code: 'auto_index_invalid_limit', source: 'feature.md' });
		expect(page.frontmatter.auto_index).toBeUndefined();
	});

	test('a frontmatter parse error and a bad auto_index can co-occur — two warnings', () => {
		// Invalid `date` (a field error → frontmatter_parse_error) plus a bad sort.
		const { warnings } = buildPage(
			root,
			write('feature.md', 'date: not-a-date\nauto_index:\n  path: writing\n  sort: bogus')
		);
		expect(warnings.map((w) => w.code).sort()).toEqual([
			'auto_index_invalid_sort',
			'frontmatter_parse_error'
		]);
		// buildPage guarantees frontmatter_parse_error before auto_index_*.
		expect(warnings.map((w) => w.code)).toEqual([
			'frontmatter_parse_error',
			'auto_index_invalid_sort'
		]);
	});
});
