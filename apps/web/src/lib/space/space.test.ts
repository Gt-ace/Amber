import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { Space } from './space.ts';
import { SpaceCache } from './cache.ts';
import { bodyHash } from '$lib/render/cache';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

function copyFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), 'amber-space-'));
	// Run the copy with an explicit umask: `node:fs.cpSync` and a bare
	// `cp -r` both inherit a restrictive umask from the bun-vitest worker,
	// leaving directories at 0o644 (no execute), which makes the tree
	// untraversable and unremovable.
	const src = FIXTURE.replace(/\/$/, '');
	execSync(`umask 022 && cp -r "${src}/." "${dir}/"`, { shell: '/bin/sh' });
	return dir;
}

describe('Space.load()', () => {
	test('returns a Space handle with the same data the pure loader produces', () => {
		const { space, warnings } = Space.load(FIXTURE);
		expect(space).toBeInstanceOf(Space);
		expect(space.manifest.amber_version).toBe('0.1');
		expect(space.pages.size).toBe(8);

		// v0.2 nav is opaque to the loader, so the fixture triggers no
		// LoadWarnings (malformed entries are logged + skipped, not surfaced).
		expect(warnings).toEqual([]);

		// `space.warnings` is the same live array the second tuple element points at.
		expect(space.warnings).toBe(warnings);

		// Validated nav: 5 valid entries (the malformed "Talks" is dropped).
		expect(space.nav.map((e) => e.label)).toEqual([
			'About',
			'Projects',
			'On tea',
			'Mastodon',
			'Say hi'
		]);

		space.close();
	});

	test('does not rewrite amber.toml on disk', () => {
		const manifestPath = join(FIXTURE, 'amber.toml');
		const before = readFileSync(manifestPath);
		const { space } = Space.load(FIXTURE);
		const after = readFileSync(manifestPath);
		expect(after.equals(before)).toBe(true);
		space.close();
	});
});

describe('Space.apply()', () => {
	let dir: string;
	let space: Space;

	beforeEach(() => {
		dir = copyFixture();
		({ space } = Space.load(dir));
	});

	afterEach(() => {
		space.close();
		rmSync(dir, { recursive: true, force: true });
	});

	test('add: indexes a brand-new page', () => {
		writeFileSync(join(dir, 'colophon.md'), '---\ntitle: Colophon\n---\n\nbody.');
		const delta = space.apply({ type: 'add', path: 'colophon.md' });

		expect(space.pages.has('/colophon')).toBe(true);
		expect(space.pages.get('/colophon')!.frontmatter.title).toBe('Colophon');
		expect(delta).toEqual([]);
	});

	test('add: does not affect the validated nav (v0.2 nav is opaque to the page index)', () => {
		// v0.1 used to drop a `manifest_nav_missing_target` warning when the
		// referenced file finally appeared. v0.2 nav is `{label, href}` —
		// `href` is not resolved against pages — so adding a page never
		// changes the nav array.
		const navBefore = [...space.nav];
		writeFileSync(join(dir, 'talks.md'), '---\ntitle: Talks\n---\n\nUpcoming.');
		space.apply({ type: 'add', path: 'talks.md' });
		expect(space.nav).toEqual(navBefore);
		expect(space.warnings).toEqual([]);
	});

	test('change: re-parses the page in place', () => {
		writeFileSync(join(dir, 'about.md'), '---\ntitle: New About\n---\n\nfresh body');
		space.apply({ type: 'change', path: 'about.md' });

		const page = space.pages.get('/about')!;
		expect(page.frontmatter.title).toBe('New About');
		expect(page.body.trim()).toBe('fresh body');
	});

	test('change: a slug change moves the page to the new URL', () => {
		writeFileSync(join(dir, 'about.md'), '---\nslug: about-me\n---\n\nbody');
		space.apply({ type: 'change', path: 'about.md' });

		expect(space.pages.has('/about')).toBe(false);
		expect(space.pages.has('/about-me')).toBe(true);
		// Manifest nav has `href = "/about"` but v0.2 nav doesn't resolve
		// against the page index — the entry stays put regardless.
		expect(space.nav.find((e) => e.href === '/about')).toBeDefined();
	});

	test('change: malformed frontmatter emits warning; fixing it clears the warning', () => {
		writeFileSync(join(dir, 'about.md'), '---\ntitle: [unterminated\n---\nbody');
		const delta1 = space.apply({ type: 'change', path: 'about.md' });
		expect(
			delta1.some((w) => w.code === 'frontmatter_parse_error' && w.source === 'about.md')
		).toBe(true);
		expect(
			space.warnings.some((w) => w.code === 'frontmatter_parse_error' && w.source === 'about.md')
		).toBe(true);

		writeFileSync(join(dir, 'about.md'), '---\ntitle: Fixed\n---\nbody');
		space.apply({ type: 'change', path: 'about.md' });
		expect(
			space.warnings.some((w) => w.code === 'frontmatter_parse_error' && w.source === 'about.md')
		).toBe(false);
	});

	test('add/change: multiple warnings for the same source are tracked and cleared together', () => {
		// A file with both an invalid date (→ frontmatter_parse_error) and an
		// auto_index pointing at a non-existent directory (→ auto_index_path_missing)
		// produces two warnings for the same source. When the file is fixed, both
		// warnings must be cleared — exercising the Map<string, LoadWarning[]> path.
		writeFileSync(
			join(dir, 'features.md'),
			'---\ndate: not-a-date\nauto_index:\n  path: this-dir-does-not-exist\n---\nbody\n'
		);
		space.apply({ type: 'add', path: 'features.md' });

		const warningsForSource = space.warnings.filter((w) => w.source === 'features.md');
		const codes = warningsForSource.map((w) => w.code).sort();
		expect(codes).toEqual(['auto_index_path_missing', 'frontmatter_parse_error']);

		// Fix the file — both warnings must be gone after the change event.
		writeFileSync(join(dir, 'features.md'), '---\ntitle: Features\n---\nbody\n');
		space.apply({ type: 'change', path: 'features.md' });

		expect(space.warnings.filter((w) => w.source === 'features.md')).toEqual([]);
	});

	test('unlink: removes the page; nav is unaffected (v0.2 hrefs are opaque)', () => {
		unlinkSync(join(dir, 'about.md'));
		const delta = space.apply({ type: 'unlink', path: 'about.md' });

		expect(space.pages.has('/about')).toBe(false);
		// v0.2 nav is `{label, href}` — the loader does not validate `href`
		// against the page index, so unlinking `about.md` does not change
		// `space.nav`. The author is responsible for keeping nav in sync.
		expect(space.nav.find((e) => e.href === '/about')).toBeDefined();
		expect(delta).toEqual([]);
	});

	test('unlink: of a non-indexed page is a no-op', () => {
		const before = space.pages.size;
		const delta = space.apply({ type: 'unlink', path: 'never-existed.md' });
		expect(space.pages.size).toBe(before);
		expect(delta).toEqual([]);
	});

	test('manifest_change: re-parses amber.toml and reconciles nav', () => {
		const original = readFileSync(join(dir, 'amber.toml'), 'utf8');
		const updated = original.replace('label = "Say hi"', 'label = "Say hello"');
		writeFileSync(join(dir, 'amber.toml'), updated);

		space.apply({ type: 'manifest_change' });

		const sayHi = space.nav.find((e) => e.href === '/say-hi');
		expect(sayHi).toBeDefined();
		expect(sayHi?.label).toBe('Say hello');
	});

	test('manifest_change: fixing a malformed nav entry adds it to the validated nav', () => {
		// The fixture's last `[[nav]]` table has `label = "Talks"` but no
		// `href`, so it's skipped at load time. Add an `href` and the entry
		// should appear in `space.nav` after the manifest reload.
		const original = readFileSync(join(dir, 'amber.toml'), 'utf8');
		const updated = original.replace(
			'[[nav]]\nlabel = "Talks"',
			'[[nav]]\nlabel = "Talks"\nhref = "/talks"'
		);
		expect(updated).not.toBe(original);
		writeFileSync(join(dir, 'amber.toml'), updated);

		space.apply({ type: 'manifest_change' });
		const talks = space.nav.find((e) => e.label === 'Talks');
		expect(talks).toEqual({ label: 'Talks', href: '/talks' });
	});

	test('manifest_change: redirects are recomputed', () => {
		const original = readFileSync(join(dir, 'amber.toml'), 'utf8');
		const updated = original.replace('"/blog" = "/notes"', '"/journal" = "/notes"');
		writeFileSync(join(dir, 'amber.toml'), updated);

		space.apply({ type: 'manifest_change' });
		expect(space.redirects.has('/blog')).toBe(false);
		expect(space.redirects.get('/journal')).toBe('/notes');
	});

	test('apply mutates the same arrays/maps that callers captured', () => {
		const pagesRef = space.pages;
		const navRef = space.nav;
		const warningsRef = space.warnings;

		writeFileSync(join(dir, 'colophon.md'), '---\ntitle: C\n---\n');
		space.apply({ type: 'add', path: 'colophon.md' });

		expect(space.pages).toBe(pagesRef);
		expect(space.warnings).toBe(warningsRef);
		// `nav` is reassigned on each reconcile; that's part of the contract.
		// We check that the *warnings* array identity holds since consumers
		// are likeliest to keep that handle around.
		expect(navRef).not.toBe(undefined);
	});
});

describe('Space.vacuumRenderCache', () => {
	let dir: string;

	beforeEach(() => {
		dir = copyFixture();
		// The committed fixture's `.amber/cache.db` may carry leftover render
		// rows from development runs; wipe `.amber/` so the test seeds its
		// own renders against an empty table (and `INSERT ... ON CONFLICT DO
		// NOTHING` doesn't silently skip our seeded rows).
		rmSync(join(dir, '.amber'), { recursive: true, force: true });
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('cold load drops orphan render rows whose hash matches no page body', () => {
		// Seed three orphan render rows directly via SpaceCache, then close
		// it so Space.load() can take ownership of the connection.
		const seed = new SpaceCache(dir);
		seed.putRender('orphan-one', '<p>old one</p>');
		seed.putRender('orphan-two', '<p>old two</p>');
		seed.putRender('orphan-three', '<p>old three</p>');
		expect(seed.getRender('orphan-one')).toBe('<p>old one</p>');
		seed.close();

		const { space } = Space.load(dir);
		// Re-open the cache through the Space — orphans must be gone after
		// load() ran vacuum.
		expect(space.getCachedRender('orphan-one')).toBeNull();
		expect(space.getCachedRender('orphan-two')).toBeNull();
		expect(space.getCachedRender('orphan-three')).toBeNull();
		space.close();
	});

	test('cold load preserves render rows whose hash matches a current page body', () => {
		// First load to populate page index, capture a real body hash.
		const first = Space.load(dir);
		const aboutPage = first.space.pages.get('/about')!;
		const aboutHash = bodyHash(aboutPage.body);
		// Seed a row matching the current /about body and one orphan row.
		first.space.putCachedRender(aboutHash, '<p>about html</p>');
		first.space.putCachedRender('definitely-orphan', '<p>orphan</p>');
		first.space.close();

		// Second cold load (cache hydrates; vacuum still runs).
		const { space } = Space.load(dir);
		expect(space.getCachedRender(aboutHash)).toBe('<p>about html</p>');
		expect(space.getCachedRender('definitely-orphan')).toBeNull();
		space.close();
	});

	test('returns 0 when the cache is off', () => {
		const { space } = Space.load(dir, { cache: false });
		expect(space.vacuumRenderCache()).toBe(0);
		space.close();
	});
});

describe('Space.load() cache resilience', () => {
	let dir: string;

	beforeEach(() => {
		dir = copyFixture();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('stale schema_version in an existing cache.db is wiped and rebuilt at the current version', () => {
		// Simulate a deploy scenario: a previous version of Amber wrote a
		// cache.db, then an Amber upgrade bumped SCHEMA_VERSION. The next cold
		// start must wipe the old cache and rebuild from the filesystem rather
		// than hydrating bogus rows from a prior schema.
		const cache = new SpaceCache(dir);
		const dbPath = join(dir, '.amber', 'cache.db');
		// Release the SpaceCache handle so we can poke the file directly
		// without lock contention.
		cache.close();

		const raw = new Database(dbPath);
		raw.exec("UPDATE meta SET value = '0' WHERE key = 'schema_version'");
		raw.exec(
			'INSERT INTO pages(rel, url, frontmatter, extra, body, mtime, content_hash) ' +
				"VALUES ('fake.md', '/fake', '{}', '{}', 'fake body', 1, 'fakehash')"
		);
		raw.close();

		const result = Space.load(dir);
		// Real fixture pages are present, the fake one isn't.
		expect(result.space.pages.has('/fake')).toBe(false);
		expect(result.space.pages.has('/about')).toBe(true);
		expect(result.space.pages.size).toBe(8);
		result.space.close();

		// Reopen the cache directly and assert schema_version is current.
		const verify = new Database(join(dir, '.amber', 'cache.db'));
		const row = verify.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
			value: string;
		} | null;
		verify.close();
		expect(row?.value).toBe('3');
	});

	test('corrupt cache.db is detected, wiped, and rebuilt', () => {
		// Simulate the disaster path: a non-SQLite junk file at cache.db (a
		// truncation, a replaced file, a half-flushed write).
		const amberDir = join(dir, '.amber');
		execSync(`mkdir -p "${amberDir}"`, { shell: '/bin/sh' });
		const dbPath = join(amberDir, 'cache.db');
		// Remove WAL/SHM siblings the fixture might carry; we want a single
		// junk file at cache.db with no helper artifacts.
		rmSync(dbPath + '-wal', { force: true });
		rmSync(dbPath + '-shm', { force: true });
		writeFileSync(dbPath, 'this is not a sqlite database');

		const result = Space.load(dir);
		expect(result.space.pages.has('/about')).toBe(true);
		expect(result.space.pages.size).toBe(8);
		result.space.close();

		// The junk file must have been replaced with a real SQLite database.
		// Open it directly — if recovery worked, this succeeds and the
		// schema_version row is set to the current value.
		const verify = new Database(dbPath);
		const row = verify.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get() as {
			value: string;
		} | null;
		verify.close();
		expect(row?.value).toBe('3');
	});
});

describe('Space.apply space_config_change', () => {
	let root: string;
	const themeFiles = {
		'theme.toml': 'name = "T"\nversion = "1"\n',
		'theme.css': ':root{}',
		'chrome.html': '<!--amber:content-->',
		'page.html': '{{{html}}}',
		'error.html': '<p>{{status}}</p>'
	} as const;

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'amber-space-config-change-'));
		writeFileSync(join(root, 'amber.toml'), 'amber_version = "0.2"\n');
		writeFileSync(join(root, 'index.md'), '# hi\n');
		for (const name of ['theme-a', 'theme-b']) {
			mkdirSync(join(root, 'themes', name), { recursive: true });
			for (const [f, c] of Object.entries(themeFiles)) {
				writeFileSync(join(root, 'themes', name, f), c);
			}
		}
	});

	afterEach(() => {
		rmSync(root, { recursive: true, force: true });
	});

	test('adding space.toml swaps the active theme', () => {
		const { space } = Space.load(root, { cache: false });
		// No space.toml, no amber.toml theme → built-in floor.
		expect(space.theme.path).toBe('');

		writeFileSync(join(root, 'space.toml'), 'theme = "theme-a"\n');
		space.apply({ type: 'space_config_change' });
		expect(space.theme.name).toBe('theme-a');
	});

	test('editing space.toml swaps the theme without reload', () => {
		writeFileSync(join(root, 'space.toml'), 'theme = "theme-a"\n');
		const { space } = Space.load(root, { cache: false });
		expect(space.theme.name).toBe('theme-a');

		writeFileSync(join(root, 'space.toml'), 'theme = "theme-b"\n');
		space.apply({ type: 'space_config_change' });
		expect(space.theme.name).toBe('theme-b');
	});

	test('deleting space.toml falls through to amber.toml / amber-default / built-in', () => {
		writeFileSync(join(root, 'space.toml'), 'theme = "theme-a"\n');
		const { space } = Space.load(root, { cache: false });
		expect(space.theme.name).toBe('theme-a');

		unlinkSync(join(root, 'space.toml'));
		space.apply({ type: 'space_config_change' });
		expect(space.theme.path).toBe(''); // built-in floor (no amber.toml theme, no amber-default)
	});

	test('invalid space.toml emits space_config_invalid; theme falls through', () => {
		const { space } = Space.load(root, { cache: false });
		writeFileSync(join(root, 'space.toml'), 'this = = not toml');
		space.apply({ type: 'space_config_change' });
		expect(space.warnings.some((w) => w.code === 'space_config_invalid')).toBe(true);
	});
});
