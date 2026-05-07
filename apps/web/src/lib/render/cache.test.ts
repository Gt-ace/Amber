import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Space } from '$lib/space/space';
import { bodyHash, getOrRenderHtml } from './cache.ts';
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
		const page = fakePage({ body: '# Persisted\n' });
		const html1 = getOrRenderHtml(first.space, page);
		first.space.close();

		// Reopen. The renders row was committed to SQLite; second open finds it.
		const second = Space.load(dir);
		const putSpy = vi.spyOn(second.space, 'putCachedRender');
		const html2 = getOrRenderHtml(second.space, page);
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
