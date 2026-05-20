/**
 * Tests for `redirect_from` frontmatter parsing and redirect-map merging at
 * the loader (cold-load) layer. Cache-layer auto-rename detection is covered
 * separately in `cache.test.ts`.
 *
 * These tests build a minimal space directory in a temp dir rather than
 * extending the committed example-space fixture — the redirect surface area
 * is small enough that an inline fixture is cheaper to read than navigating
 * fixture files, and the existing fixture already exercises manifest-level
 * `[redirects]` parsing.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { load } from './load.ts';

function makeSpace(): string {
	const dir = mkdtempSync(join(tmpdir(), 'amber-redirects-'));
	writeFileSync(join(dir, 'amber.toml'), `amber_version = "0.1"\n`);
	return dir;
}

describe('redirect_from frontmatter — parsing', () => {
	let dir: string;

	beforeEach(() => {
		dir = makeSpace();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('an array of strings is preserved on the page frontmatter', () => {
		writeFileSync(join(dir, 'about.md'), '---\nredirect_from:\n  - /old\n  - /older\n---\n\nbody');
		const { space } = load(dir);
		const page = space.pages.get('/about')!;
		expect(page.frontmatter.redirect_from).toEqual(['/old', '/older']);
		// Both entries materialize in the redirects map.
		expect(space.redirects.get('/old')).toBe('/about');
		expect(space.redirects.get('/older')).toBe('/about');
	});

	test('a non-array value is dropped: page still loads, no redirect entry, no crash', () => {
		writeFileSync(join(dir, 'about.md'), '---\nredirect_from: "/old"\n---\n\nbody');
		const { space } = load(dir);
		const page = space.pages.get('/about')!;
		// Page still loaded, body intact.
		expect(page).toBeDefined();
		expect(page.body.trim()).toBe('body');
		// Redirects map didn't pick up the malformed value.
		expect(space.redirects.has('/old')).toBe(false);
	});

	test('an array containing non-strings is rejected as malformed', () => {
		writeFileSync(join(dir, 'about.md'), '---\nredirect_from:\n  - /ok\n  - 123\n---\n\nbody');
		const { space } = load(dir);
		// All redirects from this page are dropped — partial application would
		// be confusing (which entry survived?).
		expect(space.redirects.has('/ok')).toBe(false);
		expect(space.pages.has('/about')).toBe(true);
	});
});

describe('redirect_from frontmatter — merge into Space.redirects', () => {
	let dir: string;

	beforeEach(() => {
		dir = makeSpace();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('two pages with redirect_from each contribute their own entries', () => {
		writeFileSync(join(dir, 'about.md'), '---\nredirect_from:\n  - /old-about\n---\n\nbody');
		writeFileSync(
			join(dir, 'hello.md'),
			'---\nslug: say-hi\nredirect_from:\n  - /howdy\n  - /greetings\n---\n\nbody'
		);
		const { space } = load(dir);
		expect(space.redirects.get('/old-about')).toBe('/about');
		expect(space.redirects.get('/howdy')).toBe('/say-hi');
		expect(space.redirects.get('/greetings')).toBe('/say-hi');
	});

	test('manifest [redirects] and frontmatter merge; frontmatter wins on conflict', () => {
		// Manifest declares /clash → /old-target. About.md frontmatter claims
		// /clash too. Per the documented order (manifest then frontmatter),
		// frontmatter overrides — the more recently authored page-local intent
		// wins.
		writeFileSync(
			join(dir, 'amber.toml'),
			`amber_version = "0.1"\n[redirects]\n"/clash" = "/old-target"\n`
		);
		writeFileSync(join(dir, 'about.md'), '---\nredirect_from:\n  - /clash\n---\n\nbody');
		const { space } = load(dir);
		expect(space.redirects.get('/clash')).toBe('/about');
	});

	test('two pages both claiming the same source → last-write-wins, no crash', () => {
		// Page order in `pages` is filesystem-walk order, which is platform-
		// dependent. The contract is "last-write-wins, no crash"; we don't
		// pin which page wins, only that exactly one of them does.
		writeFileSync(join(dir, 'a.md'), '---\nredirect_from:\n  - /both\n---\n\nbody');
		writeFileSync(join(dir, 'b.md'), '---\nredirect_from:\n  - /both\n---\n\nbody');
		const { space } = load(dir);
		const target = space.redirects.get('/both');
		expect(target === '/a' || target === '/b').toBe(true);
	});

	test('redirect_from entries are normalized (leading slash added if missing)', () => {
		writeFileSync(join(dir, 'about.md'), '---\nredirect_from:\n  - "old-about"\n---\n\nbody');
		const { space } = load(dir);
		expect(space.redirects.get('/old-about')).toBe('/about');
	});

	test('empty-string entries in redirect_from are skipped silently', () => {
		writeFileSync(join(dir, 'about.md'), '---\nredirect_from:\n  - "/legit"\n  - ""\n---\n\nbody');
		const { space } = load(dir);
		expect(space.redirects.get('/legit')).toBe('/about');
		// Empty string didn't become a "/" redirect to /about.
		expect(space.redirects.has('/')).toBe(false);
	});
});
