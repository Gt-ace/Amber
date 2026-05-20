import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { Space } from '$lib/space/space';
import { buildSitemapXml, readSiteUrl, readSiteUrlOrWarn } from '$lib/server/sitemap';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

describe('buildSitemapXml()', () => {
	test('emits absolute URLs when siteUrl is provided', () => {
		const { space } = Space.load(FIXTURE, { cache: false });
		const xml = buildSitemapXml(space.pages.values(), 'https://amber.example');
		expect(xml).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
		expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
		expect(xml).toContain('<loc>https://amber.example/</loc>');
		expect(xml).toContain('<loc>https://amber.example/about</loc>');
		expect(xml).toContain('<loc>https://amber.example/notes/2025-09-on-tea</loc>');
		expect(xml).toContain('</urlset>');
		space.close();
	});

	test('emits relative URLs when siteUrl is null', () => {
		const { space } = Space.load(FIXTURE, { cache: false });
		const xml = buildSitemapXml(space.pages.values(), null);
		expect(xml).toContain('<loc>/</loc>');
		expect(xml).toContain('<loc>/about</loc>');
		expect(xml).not.toContain('https://');
		space.close();
	});

	test('drafts are filtered out', () => {
		const { space } = Space.load(FIXTURE, { cache: false });
		// `notes/unfinished-essay` is `draft: true` in the fixture.
		expect(space.pages.get('/notes/unfinished-essay')?.frontmatter.draft).toBe(true);

		const xml = buildSitemapXml(space.pages.values(), 'https://amber.example');
		expect(xml).not.toContain('/notes/unfinished-essay');
		// Non-draft sibling still present
		expect(xml).toContain('/notes/2025-09-on-tea');
		space.close();
	});

	test('output matches sitemap structure (regex)', () => {
		const { space } = Space.load(FIXTURE, { cache: false });
		const xml = buildSitemapXml(space.pages.values(), 'https://amber.example');
		expect(xml).toMatch(/<urlset[^>]*>/);
		expect(xml).toMatch(/<loc>[^<]+<\/loc>/);
		expect(xml).toMatch(/<url>[\s\S]*?<\/url>/);
		space.close();
	});

	test('empty page set still produces a valid envelope', () => {
		const xml = buildSitemapXml([], 'https://amber.example');
		expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
		expect(xml).toContain('<urlset');
		expect(xml).toContain('</urlset>');
	});

	test('includes <lastmod> as YYYY-MM-DD when mtime is present', () => {
		const { space } = Space.load(FIXTURE, { cache: false });
		const xml = buildSitemapXml(space.pages.values(), 'https://amber.example');
		expect(xml).toMatch(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
		space.close();
	});

	test('escapes XML special chars in <loc>', () => {
		const fakePage = {
			filePath: '/x',
			relativePath: 'q.md',
			url: '/q?a=1&b=2',
			frontmatter: {},
			extra: {},
			body: '',
			mtime: 0,
			contentHash: 'h'
		};
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const xml = buildSitemapXml([fakePage as any], 'https://amber.example');
		expect(xml).toContain('<loc>https://amber.example/q?a=1&amp;b=2</loc>');
	});
});

describe('readSiteUrl()', () => {
	const original = process.env.PUBLIC_SITE_URL;
	beforeEach(() => {
		delete process.env.PUBLIC_SITE_URL;
	});
	afterEach(() => {
		if (original === undefined) delete process.env.PUBLIC_SITE_URL;
		else process.env.PUBLIC_SITE_URL = original;
	});

	test('returns null when unset', () => {
		expect(readSiteUrl()).toBeNull();
	});

	test('returns null for empty/whitespace', () => {
		process.env.PUBLIC_SITE_URL = '   ';
		expect(readSiteUrl()).toBeNull();
	});

	test('strips trailing slashes', () => {
		process.env.PUBLIC_SITE_URL = 'https://amber.example/';
		expect(readSiteUrl()).toBe('https://amber.example');
		process.env.PUBLIC_SITE_URL = 'https://amber.example///';
		expect(readSiteUrl()).toBe('https://amber.example');
	});

	test('returns the value as-is when no trailing slash', () => {
		process.env.PUBLIC_SITE_URL = 'https://amber.example';
		expect(readSiteUrl()).toBe('https://amber.example');
	});
});

describe('readSiteUrlOrWarn()', () => {
	const original = process.env.PUBLIC_SITE_URL;
	beforeEach(() => {
		delete process.env.PUBLIC_SITE_URL;
	});
	afterEach(() => {
		if (original === undefined) delete process.env.PUBLIC_SITE_URL;
		else process.env.PUBLIC_SITE_URL = original;
	});

	test('returns null when env is unset', () => {
		// The "logs a warning" side-effect is verified by the structured-logger
		// path at runtime; spying on a pino child logger from a test is more
		// trouble than it's worth, and the value-return behavior is the
		// load-bearing contract.
		const result = readSiteUrlOrWarn();
		expect(result).toBeNull();
	});

	test('returns siteUrl when env is set', () => {
		process.env.PUBLIC_SITE_URL = 'https://amber.example';
		const result = readSiteUrlOrWarn();
		expect(result).toBe('https://amber.example');
	});
});
