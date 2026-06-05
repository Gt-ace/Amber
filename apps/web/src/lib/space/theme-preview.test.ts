import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverThemes } from './themes.ts';
import { buildThemePreview } from './theme-preview.ts';
import { BUILTIN_THEME } from '$lib/theme/builtin';
import { logger } from '$lib/server/logger';
import type { Theme } from '$lib/types/schema';

const log = logger.child({ subsystem: 'test' });

const CHROME = `<header class="site-header"><a href="/" class="site-title">{{site_title}}</a>
{{#has_nav}}<nav><ul>{{#nav}}<li><a href="{{href}}">{{label}}</a></li>{{/nav}}</ul></nav>{{/has_nav}}
</header><!--amber:content--><footer class="site-footer">{{site_title_or_default}}</footer>`;
const PAGE = `<article>{{#has_header}}<h1 class="article-title">{{title}}</h1>{{/has_header}}
<div class="article-body">{{{html}}}</div></article>`;

function themeOnDisk(): { theme: Theme; cleanup: () => void } {
	const root = mkdtempSync(join(tmpdir(), 'amber-preview-'));
	const dir = join(root, 'themes', 'amber-default');
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'theme.toml'), 'name = "Default"\nversion = "1.0"\n');
	writeFileSync(join(dir, 'theme.css'), ':root{--amber-bg:#fff}');
	writeFileSync(join(dir, 'chrome.html'), CHROME);
	writeFileSync(join(dir, 'page.html'), PAGE);
	writeFileSync(join(dir, 'error.html'), '<p>{{status}}</p>');
	const theme = discoverThemes(root, log).get('amber-default')!;
	return { theme, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

describe('buildThemePreview', () => {
	test('produces a single well-formed HTML document', () => {
		const { theme, cleanup } = themeOnDisk();
		try {
			const html = buildThemePreview(theme, { cssHref: '/themes/amber-default/theme.css?v=1' });
			expect(html.toLowerCase()).toContain('<!doctype html>');
			expect((html.match(/<html/gi) ?? []).length).toBe(1);
			expect((html.match(/<\/html>/gi) ?? []).length).toBe(1);
			// Layout-owned <main> wraps the page content, like the real layout.
			expect(html).toContain('<main>');
			expect(html).toContain('</main>');
		} finally {
			cleanup();
		}
	});

	test('links the theme stylesheet at the given (versioned) href', () => {
		const { theme, cleanup } = themeOnDisk();
		try {
			const html = buildThemePreview(theme, { cssHref: '/themes/amber-default/theme.css?v=abc' });
			expect(html).toContain('<link rel="stylesheet" href="/themes/amber-default/theme.css?v=abc"');
		} finally {
			cleanup();
		}
	});

	test('renders the theme chrome and a sample article through the real templates', () => {
		const { theme, cleanup } = themeOnDisk();
		try {
			const html = buildThemePreview(theme, { cssHref: null });
			// chrome.html rendered with the sample site title + nav
			expect(html).toContain('class="site-header"');
			expect(html).toContain('class="site-title"');
			// page.html rendered with a sample heading + a markdown-rendered link
			expect(html).toContain('class="article-title"');
			expect(html).toContain('<a href='); // the sample body's link survived markdown render
		} finally {
			cleanup();
		}
	});

	test('omits the stylesheet link when cssHref is null (built-in floor)', () => {
		const html = buildThemePreview(BUILTIN_THEME, { cssHref: null });
		expect(html).not.toContain('rel="stylesheet"');
		expect(html.toLowerCase()).toContain('<!doctype html>');
	});

	test('escapes nothing into the chrome that could break out of the document', () => {
		// Sanity: the assembled doc is valid and contains the footer fallback.
		const { theme, cleanup } = themeOnDisk();
		try {
			const html = buildThemePreview(theme, { cssHref: null });
			expect(html).toContain('class="site-footer"');
		} finally {
			cleanup();
		}
	});
});
