import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Space } from '$lib/space/space';
import { renderPageBody } from './page.ts';

function makeSpace(): { dir: string; space: Space } {
	const dir = mkdtempSync(join(tmpdir(), 'amber-render-page-'));
	writeFileSync(join(dir, 'amber.toml'), 'amber_version = "0.1"\n');
	mkdirSync(join(dir, 'blog'));
	writeFileSync(
		join(dir, 'blog', 'index.md'),
		'---\ntitle: Blog\nauto_index:\n  path: blog\n---\nWelcome to the blog.\n'
	);
	writeFileSync(
		join(dir, 'blog', 'post-a.md'),
		'---\ntitle: First post\ndate: "2025-03-01"\n---\nA.\n'
	);
	writeFileSync(
		join(dir, 'blog', 'post-b.md'),
		'---\ntitle: Second post\ndate: "2025-05-01"\n---\nB.\n'
	);
	writeFileSync(
		join(dir, 'blog', 'unfinished.md'),
		'---\ntitle: Unfinished\ndraft: true\n---\nDraft.\n'
	);
	writeFileSync(join(dir, 'about.md'), '---\ntitle: About\n---\nAbout.\n');
	writeFileSync(
		join(dir, 'capped.md'),
		'---\ntitle: Capped\nauto_index:\n  path: blog\n  limit: 1\n---\n'
	);
	const { space } = Space.load(dir, { cache: false });
	return { dir, space };
}

describe('renderPageBody', () => {
	let dir: string;
	let space: Space;
	beforeEach(() => ({ dir, space } = makeSpace()));
	afterEach(() => {
		space.close();
		rmSync(dir, { recursive: true, force: true });
	});

	test('a page with auto_index renders the partial below its body, newest first, host/draft excluded', () => {
		const { bodyHtml } = renderPageBody(space, space.pages.get('/blog')!, { dev: false });
		expect(bodyHtml).toContain('Welcome to the blog.');
		expect(bodyHtml).toContain('<ul class="amber-auto-index">');
		expect(bodyHtml.indexOf('href="/blog/post-b"')).toBeGreaterThan(-1);
		expect(bodyHtml.indexOf('href="/blog/post-b"')).toBeLessThan(
			bodyHtml.indexOf('href="/blog/post-a"')
		);
		expect(bodyHtml.indexOf('Welcome to the blog.')).toBeLessThan(
			bodyHtml.indexOf('amber-auto-index')
		);
		expect(bodyHtml).not.toContain('href="/blog"');
		expect(bodyHtml).not.toContain('href="/blog/unfinished"');
	});

	test('limit caps the rendered list', () => {
		const { bodyHtml } = renderPageBody(space, space.pages.get('/capped')!, { dev: false });
		expect(bodyHtml).toContain('href="/blog/post-b"');
		expect(bodyHtml).not.toContain('href="/blog/post-a"');
	});

	test('a page with no auto_index renders no index list', () => {
		const { html, bodyHtml } = renderPageBody(space, space.pages.get('/about')!, { dev: false });
		expect(bodyHtml).not.toContain('amber-auto-index');
		expect(html).toContain('<p>About.</p>');
		expect(bodyHtml).toContain(html);
	});

	test('returns the rendered markdown as `html` and the themed wrapper as `bodyHtml`', () => {
		const { html, bodyHtml } = renderPageBody(space, space.pages.get('/about')!, { dev: false });
		expect(html).toContain('<p>About.');
		expect(bodyHtml).toContain('<article>');
		expect(bodyHtml).toContain('class="article-body"');
		expect(bodyHtml).toContain(html);
	});
});

describe('renderPageBody — is_home', () => {
	let dir: string;
	let space: Space;
	beforeEach(() => {
		dir = mkdtempSync(join(tmpdir(), 'amber-render-ishome-'));
		writeFileSync(join(dir, 'amber.toml'), 'amber_version = "0.1"\ntheme = "probe"\n');
		writeFileSync(join(dir, 'index.md'), '---\ntitle: Home\n---\nHome body.\n');
		writeFileSync(join(dir, 'about.md'), '---\ntitle: About\n---\nAbout body.\n');
		const t = join(dir, 'themes', 'probe');
		mkdirSync(t, { recursive: true });
		writeFileSync(join(t, 'theme.toml'), 'name = "probe"\n');
		writeFileSync(join(t, 'chrome.html'), '<header></header><!--amber:content--><footer></footer>');
		writeFileSync(
			join(t, 'page.html'),
			'{{#is_home}}LANDING{{/is_home}}{{^is_home}}ARTICLE{{/is_home}}|{{{html}}}'
		);
		writeFileSync(join(t, 'error.html'), 'err');
		({ space } = Space.load(dir, { cache: false }));
	});
	afterEach(() => {
		space.close();
		rmSync(dir, { recursive: true, force: true });
	});

	test('is_home is true for the root index and false for a sub-page', () => {
		const home = renderPageBody(space, space.pages.get('/')!, { dev: false });
		expect(home.bodyHtml).toContain('LANDING');
		expect(home.bodyHtml).not.toContain('ARTICLE');

		const about = renderPageBody(space, space.pages.get('/about')!, { dev: false });
		expect(about.bodyHtml).toContain('ARTICLE');
		expect(about.bodyHtml).not.toContain('LANDING');
	});
});
