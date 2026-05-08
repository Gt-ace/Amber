import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { Space } from './space.ts';
import { SpaceCache } from './cache.ts';

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

		// Warnings: the same two the fixture is designed to trigger.
		const codes = warnings.map((w) => w.code).sort();
		expect(codes).toEqual(['manifest_nav_missing_target', 'reserved_name_in_content']);

		// `space.warnings` is the same live array the second tuple element points at.
		expect(space.warnings).toBe(warnings);

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

	test('add: invalidates a manifest_nav_missing_target warning when the missing file appears', () => {
		// Fixture has `talks.md` referenced in manifest but not on disk.
		const before = space.warnings.find(
			(w) => w.code === 'manifest_nav_missing_target' && w.source === 'talks.md'
		);
		expect(before).toBeDefined();

		writeFileSync(join(dir, 'talks.md'), '---\ntitle: Talks\n---\n\nUpcoming.');
		const delta = space.apply({ type: 'add', path: 'talks.md' });

		// Warning gone from cumulative; not a negative entry in the delta.
		expect(
			space.warnings.find(
				(w) => w.code === 'manifest_nav_missing_target' && w.source === 'talks.md'
			)
		).toBeUndefined();
		expect(delta.some((w) => w.code === 'manifest_nav_missing_target')).toBe(false);

		// Nav now contains the Talks entry.
		const labels = space.nav.flatMap((e) => (e.kind === 'page' ? [e.label] : []));
		expect(labels).toContain('Talks');
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
		// Manifest still references about.md → still a valid entry → no missing warning.
		expect(
			space.warnings.find(
				(w) => w.code === 'manifest_nav_missing_target' && w.source === 'about.md'
			)
		).toBeUndefined();
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

	test('unlink: removes the page; nav loses it; missing warning appears for manifest references', () => {
		unlinkSync(join(dir, 'about.md'));
		const delta = space.apply({ type: 'unlink', path: 'about.md' });

		expect(space.pages.has('/about')).toBe(false);
		// `about.md` is referenced by the manifest's nav, so a fresh
		// missing-target warning should appear in both the delta and the
		// cumulative array.
		expect(
			delta.some((w) => w.code === 'manifest_nav_missing_target' && w.source === 'about.md')
		).toBe(true);
		expect(
			space.warnings.some(
				(w) => w.code === 'manifest_nav_missing_target' && w.source === 'about.md'
			)
		).toBe(true);

		// Nav no longer surfaces the About entry.
		expect(space.nav.find((e) => e.kind === 'page' && e.url === '/about')).toBeUndefined();
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

		const sayHi = space.nav.find((e) => e.kind === 'page' && e.url === '/say-hi');
		expect(sayHi).toBeDefined();
		expect((sayHi as { label: string }).label).toBe('Say hello');
	});

	test('manifest_change: removing a missing nav entry clears its warning', () => {
		const original = readFileSync(join(dir, 'amber.toml'), 'utf8');
		// Drop the talks.md nav entry that was triggering the missing-target warning.
		const updated = original.replace(
			/\[\[nav\]\]\nkind = "page"\npath = "talks\.md"\nlabel = "Talks"\n# `talks\.md` does not exist on disk → manifest_nav_missing_target warning\.\n\n/,
			''
		);
		expect(updated).not.toBe(original);
		writeFileSync(join(dir, 'amber.toml'), updated);

		space.apply({ type: 'manifest_change' });
		expect(
			space.warnings.find(
				(w) => w.code === 'manifest_nav_missing_target' && w.source === 'talks.md'
			)
		).toBeUndefined();
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
			"INSERT INTO pages(rel, url, frontmatter, extra, body, mtime, content_hash) " +
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
		const row = verify
			.prepare("SELECT value FROM meta WHERE key = 'schema_version'")
			.get() as { value: string } | null;
		verify.close();
		expect(row?.value).toBe('2');
	});

	test('corrupt cache.db is detected, wiped, and rebuilt with a warning', () => {
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

		const warns: unknown[][] = [];
		const orig = console.warn;
		console.warn = (...a: unknown[]) => warns.push(a);
		try {
			const result = Space.load(dir);
			expect(result.space.pages.has('/about')).toBe(true);
			expect(result.space.pages.size).toBe(8);
			result.space.close();
		} finally {
			console.warn = orig;
		}

		const hit = warns.some((args) =>
			args.some((a) => typeof a === 'string' && /corrupt|rebuild/i.test(a))
		);
		expect(hit).toBe(true);
	});
});
