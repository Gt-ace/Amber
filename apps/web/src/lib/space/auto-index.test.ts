import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateAutoIndex, resolveAutoIndexEntries } from './auto-index.ts';
import type { Page, AutoIndexDirective } from '$lib/types/schema';

function fakePage(rel: string, fm: Page['frontmatter'] = {}): Page {
	const url =
		rel === 'index.md'
			? '/'
			: rel.endsWith('/index.md')
				? '/' + rel.slice(0, -'/index.md'.length)
				: '/' + rel.replace(/\.md$/, '');
	return {
		filePath: '/x/' + rel,
		relativePath: rel,
		url,
		frontmatter: fm,
		extra: {},
		body: '',
		mtime: 0,
		contentHash: 'h'
	};
}

describe('validateAutoIndex', () => {
	let root: string;
	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), 'amber-auto-index-'));
		mkdirSync(join(root, 'writing'));
		mkdirSync(join(root, 'notes', '2025'), { recursive: true });
	});
	afterEach(() => rmSync(root, { recursive: true, force: true }));

	test('valid: normalizes path, defaults sort to "date desc", drops absent limit', () => {
		const r = validateAutoIndex({ path: 'writing' }, root);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ path: 'writing', sort: 'date desc' });
	});

	test('valid: keeps an explicit sort and a positive integer limit; normalizes nested path', () => {
		const r = validateAutoIndex({ path: 'notes/2025/', sort: 'title asc', limit: 5 }, root);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value).toEqual({ path: 'notes/2025', sort: 'title asc', limit: 5 });
	});

	test('missing / non-string / empty path → auto_index_path_missing', () => {
		expect(validateAutoIndex({}, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_path_missing' }
		});
		expect(validateAutoIndex({ path: 42 }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_path_missing' }
		});
		expect(validateAutoIndex({ path: '   ' }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_path_missing' }
		});
		expect(validateAutoIndex('writing', root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_path_missing' }
		});
	});

	test('path that does not resolve to a directory under root → auto_index_path_missing', () => {
		expect(validateAutoIndex({ path: 'nope' }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_path_missing' }
		});
		expect(validateAutoIndex({ path: '../escape' }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_path_missing' }
		});
	});

	test('path "." (or all-dot) is rejected as auto_index_path_missing', () => {
		expect(validateAutoIndex({ path: '.' }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_path_missing' }
		});
		const r = validateAutoIndex({ path: 'notes/./2025' }, root);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.value.path).toBe('notes/2025');
	});

	test('bad sort → auto_index_invalid_sort', () => {
		expect(validateAutoIndex({ path: 'writing', sort: 'date' }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_invalid_sort' }
		});
		expect(validateAutoIndex({ path: 'writing', sort: 5 }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_invalid_sort' }
		});
	});

	test('bad limit (non-integer, zero, negative) → auto_index_invalid_limit', () => {
		expect(validateAutoIndex({ path: 'writing', limit: 0 }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_invalid_limit' }
		});
		expect(validateAutoIndex({ path: 'writing', limit: -3 }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_invalid_limit' }
		});
		expect(validateAutoIndex({ path: 'writing', limit: 2.5 }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_invalid_limit' }
		});
		expect(validateAutoIndex({ path: 'writing', limit: '3' }, root)).toMatchObject({
			ok: false,
			warning: { code: 'auto_index_invalid_limit' }
		});
	});
});

describe('resolveAutoIndexEntries', () => {
	const dir: AutoIndexDirective = { path: 'blog', sort: 'date desc' };

	const host = fakePage('blog/index.md', { title: 'Blog', auto_index: dir });
	const a = fakePage('blog/post-a.md', { title: 'Apple', date: '2025-03-01' });
	const b = fakePage('blog/post-b.md', { title: 'Banana', date: '2025-05-01' });
	const c = fakePage('blog/post-c.md', { title: 'Cherry' }); // no date
	const d = fakePage('blog/draft.md', { title: 'Draftish', draft: true });
	const outsider = fakePage('about.md', { title: 'About', date: '2025-09-01' });
	const sibling = fakePage('blog-sidecar.md', { title: 'Sidecar' }); // "blog-sidecar.md" is NOT under "blog/"
	const all = [host, a, b, c, d, outsider, sibling];

	test('date desc (default): newest first, undated last, host/draft/outsider excluded', () => {
		const out = resolveAutoIndexEntries(all, host, dir);
		expect(out.map((e) => e.href)).toEqual(['/blog/post-b', '/blog/post-a', '/blog/post-c']);
		expect(out[0]).toEqual({
			href: '/blog/post-b',
			title: 'Banana',
			date: '2025-05-01',
			updated: null
		});
	});

	test('date asc: oldest first, undated still last', () => {
		const out = resolveAutoIndexEntries(all, host, { ...dir, sort: 'date asc' });
		expect(out.map((e) => e.href)).toEqual(['/blog/post-a', '/blog/post-b', '/blog/post-c']);
	});

	test('title asc: case-insensitive locale order across all matched pages', () => {
		const out = resolveAutoIndexEntries(all, host, { ...dir, sort: 'title asc' });
		expect(out.map((e) => e.title)).toEqual(['Apple', 'Banana', 'Cherry']);
	});

	test('limit caps the list after sorting', () => {
		const out = resolveAutoIndexEntries(all, host, { ...dir, limit: 2 });
		expect(out.map((e) => e.href)).toEqual(['/blog/post-b', '/blog/post-a']);
	});

	test('a page cannot list itself even when it lives under path', () => {
		const selfHost = fakePage('blog/post-a.md', {
			title: 'Apple',
			date: '2025-03-01',
			auto_index: dir
		});
		const out = resolveAutoIndexEntries([selfHost, b, c], selfHost, dir);
		expect(out.map((e) => e.href)).toEqual(['/blog/post-b', '/blog/post-c']);
		expect(out.some((e) => e.href === '/blog/post-a')).toBe(false);
	});

	test("the listed directory's own index.md is included when it is not the host", () => {
		const featured = fakePage('featured.md', { title: 'Featured', auto_index: dir });
		const blogIndex = fakePage('blog/index.md', { title: 'Blog home' });
		const out = resolveAutoIndexEntries([featured, blogIndex, a], featured, dir);
		expect(out.map((e) => e.href).sort()).toEqual(['/blog', '/blog/post-a']);
	});

	test('entry shape: href/title/date/updated, with date and updated null when absent and title falling back to url', () => {
		const noTitle = fakePage('blog/x.md', { date: '2025-01-01', updated: '2025-02-02' });
		const out = resolveAutoIndexEntries([host, noTitle], host, dir);
		expect(out).toEqual([
			{ href: '/blog/x', title: '/blog/x', date: '2025-01-01', updated: '2025-02-02' }
		]);
	});

	test('date desc: equal dates tie-break by title', () => {
		const x = fakePage('blog/x.md', { title: 'Zebra', date: '2025-05-01' });
		const y = fakePage('blog/y.md', { title: 'Apple', date: '2025-05-01' });
		const out = resolveAutoIndexEntries([host, x, y], host, dir);
		expect(out.map((e) => e.title)).toEqual(['Apple', 'Zebra']);
	});

	test('title asc: equal titles tie-break by url', () => {
		const p1 = fakePage('blog/zzz.md', { title: 'Same' });
		const p2 = fakePage('blog/aaa.md', { title: 'Same' });
		const out = resolveAutoIndexEntries([host, p1, p2], host, { ...dir, sort: 'title asc' });
		expect(out.map((e) => e.href)).toEqual(['/blog/aaa', '/blog/zzz']);
	});
});
