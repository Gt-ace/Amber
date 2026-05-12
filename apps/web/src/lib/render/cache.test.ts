import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Space } from '$lib/space/space';
import {
	bodyHash,
	getOrRenderHtml,
	templateHash,
	pageRenderCacheKey,
	partialRenderCacheKey
} from './cache.ts';
import type { Page } from '$lib/types/schema';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

function copyFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), 'amber-render-cache-'));
	const src = FIXTURE.replace(/\/$/, '');
	execSync(`umask 022 && cp -r "${src}/." "${dir}/"`, { shell: '/bin/sh' });
	return dir;
}

function fakePage(overrides: Partial<Page> & { body: string }): Page {
	return {
		filePath: '/tmp/x.md',
		relativePath: 'x.md',
		url: '/x',
		frontmatter: {},
		extra: {},
		mtime: 0,
		contentHash: 'irrelevant',
		...overrides
	};
}

describe('getOrRenderHtml', () => {
	let dir: string;

	beforeEach(() => {
		dir = copyFixture();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('first call renders and writes; second call hits the cache', () => {
		const { space } = Space.load(dir);
		const page = fakePage({ body: '# Hello\n\nWorld.\n' });

		const renderSpy = vi.spyOn(space, 'putCachedRender');
		const html1 = getOrRenderHtml(space, page);
		expect(html1).toContain('<h1>Hello</h1>');
		expect(html1).toContain('<p>World.</p>');
		expect(renderSpy).toHaveBeenCalledTimes(1);

		// Second call: same body → same hash → cache hit, no new put.
		const html2 = getOrRenderHtml(space, page);
		expect(html2).toBe(html1);
		expect(renderSpy).toHaveBeenCalledTimes(1);

		space.close();
	});

	test('identical bodies with different frontmatter share a cache row', () => {
		const { space } = Space.load(dir);
		const body = 'A paragraph that two pages happen to share verbatim.\n';
		const a = fakePage({
			body,
			relativePath: 'a.md',
			url: '/a',
			frontmatter: { title: 'A' }
		});
		const b = fakePage({
			body,
			relativePath: 'b.md',
			url: '/b',
			frontmatter: { title: 'B' }
		});

		const putSpy = vi.spyOn(space, 'putCachedRender');
		const htmlA = getOrRenderHtml(space, a);
		expect(putSpy).toHaveBeenCalledTimes(1);
		const htmlB = getOrRenderHtml(space, b);
		// Identical bodies → identical hash → b reads a's row, never writes.
		expect(htmlB).toBe(htmlA);
		expect(putSpy).toHaveBeenCalledTimes(1);

		space.close();
	});

	test('changed body produces a new hash and a fresh render', () => {
		const { space } = Space.load(dir);
		const v1 = fakePage({ body: 'first\n' });
		const v2 = fakePage({ body: 'second\n' });

		const html1 = getOrRenderHtml(space, v1);
		const html2 = getOrRenderHtml(space, v2);
		expect(html1).not.toBe(html2);
		expect(html1).toContain('first');
		expect(html2).toContain('second');
		expect(bodyHash(v1.body)).not.toBe(bodyHash(v2.body));

		space.close();
	});

	test('cache survives Space.close()/reopen — render persists across processes', () => {
		const first = Space.load(dir);
		// Use a real page from the fixture so its body hash survives the
		// vacuum step that runs at the end of Space.load().
		const realPage = first.space.pages.get('/about')!;
		const html1 = getOrRenderHtml(first.space, realPage);
		first.space.close();

		// Reopen. The renders row was committed to SQLite; second open finds it.
		const second = Space.load(dir);
		const putSpy = vi.spyOn(second.space, 'putCachedRender');
		const reloadedPage = second.space.pages.get('/about')!;
		const html2 = getOrRenderHtml(second.space, reloadedPage);
		expect(html2).toBe(html1);
		expect(putSpy).not.toHaveBeenCalled();
		second.space.close();
	});

	test('cacheless Space (cache: false) still renders correctly, just always misses', () => {
		const { space } = Space.load(dir, { cache: false });
		const page = fakePage({ body: '# No cache\n' });
		const html = getOrRenderHtml(space, page);
		expect(html).toContain('<h1>No cache</h1>');
		// No cache to read from, so a second call re-renders. The output is
		// still correct; just no acceleration.
		const html2 = getOrRenderHtml(space, page);
		expect(html2).toBe(html);
		space.close();
	});
});

describe('bodyHash', () => {
	test('is sha256 of the body bytes — 64 hex chars, deterministic', () => {
		const h1 = bodyHash('hello');
		const h2 = bodyHash('hello');
		expect(h1).toBe(h2);
		expect(h1).toMatch(/^[0-9a-f]{64}$/);
	});

	test('differs across different inputs', () => {
		expect(bodyHash('a')).not.toBe(bodyHash('b'));
	});
});

describe('templateHash', () => {
	test('sha256 of the source bytes — 64 hex chars, deterministic, input-sensitive', () => {
		expect(templateHash('<article>{{{html}}}</article>')).toMatch(/^[0-9a-f]{64}$/);
		expect(templateHash('a')).toBe(templateHash('a'));
		expect(templateHash('a')).not.toBe(templateHash('b'));
	});
});

describe('pageRenderCacheKey', () => {
	const base = {
		templateSource: '<article>{{{html}}}{{{index_html}}}</article>',
		bodyHtml: '<p>hi</p>',
		indexHtml: '',
		data: { title: 'X' }
	};

	test('same inputs → same key', () => {
		expect(pageRenderCacheKey(base)).toBe(pageRenderCacheKey({ ...base }));
	});
	test('changing the template source changes the key (cache invalidates on template edit)', () => {
		expect(pageRenderCacheKey(base)).not.toBe(
			pageRenderCacheKey({ ...base, templateSource: base.templateSource + '\n' })
		);
	});
	test('changing the body HTML changes the key', () => {
		expect(pageRenderCacheKey(base)).not.toBe(
			pageRenderCacheKey({ ...base, bodyHtml: '<p>bye</p>' })
		);
	});
	test('changing the auto-index HTML changes the key', () => {
		expect(pageRenderCacheKey(base)).not.toBe(
			pageRenderCacheKey({ ...base, indexHtml: '<ul></ul>' })
		);
	});
	test('changing the substitution data changes the key', () => {
		expect(pageRenderCacheKey(base)).not.toBe(
			pageRenderCacheKey({ ...base, data: { title: 'Y' } })
		);
	});
	test('returns a 64-hex-char digest', () => {
		expect(pageRenderCacheKey(base)).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('partialRenderCacheKey', () => {
	const partial =
		'<ul class="amber-auto-index">{{#index_entries}}<li>{{title}}</li>{{/index_entries}}</ul>';
	const entries = [{ href: '/a', title: 'A', date: '2025-01-01', updated: null }];

	test('same partial + same entries → same key', () => {
		expect(partialRenderCacheKey(partial, entries)).toBe(
			partialRenderCacheKey(partial, [
				{ href: '/a', title: 'A', date: '2025-01-01', updated: null }
			])
		);
	});
	test('changing the partial source changes the key', () => {
		expect(partialRenderCacheKey(partial, entries)).not.toBe(
			partialRenderCacheKey(partial + ' ', entries)
		);
	});
	test('changing the entries changes the key', () => {
		expect(partialRenderCacheKey(partial, entries)).not.toBe(
			partialRenderCacheKey(partial, [
				...entries,
				{ href: '/b', title: 'B', date: null, updated: null }
			])
		);
	});
});
