import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverThemes, resolveActiveTheme, readTemplate, readPartial } from './themes.ts';
import { BUILTIN_THEME, BUILTIN_PARTIALS } from '$lib/theme/builtin';
import type { AmberManifest } from '$lib/types/schema';
import { logger } from '$lib/server/logger';

const log = logger.child({ subsystem: 'test' });

function scratchSpace(): string {
	return mkdtempSync(join(tmpdir(), 'amber-themes-'));
}

function writeTheme(root: string, name: string, files: Record<string, string>): void {
	const dir = join(root, 'themes', name);
	mkdirSync(dir, { recursive: true });
	for (const [file, content] of Object.entries(files)) writeFileSync(join(dir, file), content);
}

const FULL_THEME_FILES = {
	'theme.toml':
		'name = "Pretty"\nversion = "1.0"\n[theme_color]\nlight = "#fff"\ndark = "#000"\n[footer]\nlabel = "Source"\nhref = "https://example.com"\n',
	'theme.css': ':root { --x: 1 }',
	'chrome.html': '<header></header><!--amber:content--><footer></footer>',
	'page.html': '<article>{{{html}}}</article>',
	'error.html': '<p>{{status}}</p>'
};

describe('discoverThemes', () => {
	test('empty / missing themes dir → empty map', () => {
		const root = scratchSpace();
		try {
			expect(discoverThemes(root, log).size).toBe(0);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('a complete theme is discovered with parsed manifest; readTemplate returns its files', () => {
		const root = scratchSpace();
		try {
			writeTheme(root, 'amber-default', FULL_THEME_FILES);
			const themes = discoverThemes(root, log);
			const t = themes.get('amber-default');
			expect(t).toBeDefined();
			expect(t!.name).toBe('amber-default');
			expect(t!.path).toBe(join(root, 'themes', 'amber-default'));
			expect(t!.assetBase).toBe('/themes/amber-default');
			expect(t!.manifest.name).toBe('Pretty');
			expect(t!.manifest.theme_color).toEqual({ light: '#fff', dark: '#000' });
			expect(t!.manifest.footer).toEqual({ label: 'Source', href: 'https://example.com' });
			expect(readTemplate(t!, 'chrome')).toContain('<!--amber:content-->');
			expect(readTemplate(t!, 'page')).toContain('{{{html}}}');
			expect(readTemplate(t!, 'error')).toContain('{{status}}');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('readTemplate on the built-in theme returns the in-app constants', () => {
		expect(readTemplate(BUILTIN_THEME, 'chrome')).toContain('<!--amber:content-->');
		expect(readTemplate(BUILTIN_THEME, 'error')).toContain('{{status}}');
	});

	test('a theme missing a template file is skipped (logged, not thrown)', () => {
		const root = scratchSpace();
		try {
			const partial: Record<string, string> = { ...FULL_THEME_FILES };
			delete partial['page.html'];
			writeTheme(root, 'broken', partial);
			writeTheme(root, 'amber-default', FULL_THEME_FILES);
			const themes = discoverThemes(root, log);
			expect(themes.has('broken')).toBe(false);
			expect(themes.has('amber-default')).toBe(true);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('a theme with a malformed theme.toml is skipped', () => {
		const root = scratchSpace();
		try {
			writeTheme(root, 'bad-toml', { ...FULL_THEME_FILES, 'theme.toml': 'this = = not toml' });
			expect(discoverThemes(root, log).has('bad-toml')).toBe(false);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

describe('resolveActiveTheme', () => {
	const themes = (() => {
		const root = scratchSpace();
		writeTheme(root, 'amber-default', FULL_THEME_FILES);
		writeTheme(root, 'other', FULL_THEME_FILES);
		writeTheme(root, 'editorial', FULL_THEME_FILES);
		const m = discoverThemes(root, log);
		rmSync(root, { recursive: true, force: true });
		return m;
	})();

	test('chain step 4: no config at all → amber-default', () => {
		const m: AmberManifest = { amber_version: '0.2' };
		const { theme, warnings } = resolveActiveTheme(themes, m, null, log);
		expect(theme.name).toBe('amber-default');
		expect(warnings).toEqual([]);
	});

	test('chain step 2: amber.toml `theme` resolves when space.toml absent', () => {
		const m: AmberManifest = { amber_version: '0.2', theme: 'other' };
		const { theme, warnings } = resolveActiveTheme(themes, m, null, log);
		expect(theme.name).toBe('other');
		expect(warnings).toEqual([]);
	});

	test('chain step 2: amber.toml object `theme = { name }` resolves', () => {
		const m: AmberManifest = { amber_version: '0.2', theme: { name: 'other' } };
		const { theme } = resolveActiveTheme(themes, m, null, log);
		expect(theme.name).toBe('other');
	});

	test('chain step 1: space.toml `theme` overrides amber.toml', () => {
		const m: AmberManifest = { amber_version: '0.2', theme: 'other' };
		const { theme, warnings } = resolveActiveTheme(themes, m, { theme: 'editorial' }, log);
		expect(theme.name).toBe('editorial');
		expect(warnings).toEqual([]);
	});

	test('space.toml names a missing theme → warns and falls through to amber.toml', () => {
		const m: AmberManifest = { amber_version: '0.2', theme: 'other' };
		const { theme, warnings } = resolveActiveTheme(themes, m, { theme: 'nope' }, log);
		expect(theme.name).toBe('other');
		expect(warnings).toHaveLength(1);
		expect(warnings[0].code).toBe('space_theme_not_found');
		expect(warnings[0].message).toContain('nope');
	});

	test('both space.toml and amber.toml name missing themes → two warnings, then amber-default', () => {
		const m: AmberManifest = { amber_version: '0.2', theme: 'gone' };
		const { theme, warnings } = resolveActiveTheme(themes, m, { theme: 'nope' }, log);
		expect(theme.name).toBe('amber-default');
		expect(warnings).toHaveLength(2);
		expect(warnings.map((w) => w.code)).toEqual(['space_theme_not_found', 'space_theme_not_found']);
	});

	test('chain step 4: no usable themes at all → BUILTIN_THEME, no warnings about amber-default missing', () => {
		const m: AmberManifest = { amber_version: '0.2' };
		const { theme, warnings } = resolveActiveTheme(new Map(), m, null, log);
		expect(theme).toBe(BUILTIN_THEME);
		expect(warnings).toEqual([]);
	});

	test('space.toml with no `theme` field → falls through to amber.toml', () => {
		const m: AmberManifest = { amber_version: '0.2', theme: 'other' };
		const { theme, warnings } = resolveActiveTheme(themes, m, {}, log);
		expect(theme.name).toBe('other');
		expect(warnings).toEqual([]);
	});
});

describe('readPartial', () => {
	test('built-in theme → the built-in index partial', () => {
		expect(readPartial(BUILTIN_THEME, 'index')).toBe(BUILTIN_PARTIALS.index);
		expect(BUILTIN_PARTIALS.index).toContain('class="amber-auto-index"');
		expect(BUILTIN_PARTIALS.index).toContain('{{#index_entries}}');
	});

	test('a discovered theme that ships partials/index.html → that file', () => {
		const dir = mkdtempSync(join(tmpdir(), 'amber-theme-partial-'));
		mkdirSync(join(dir, 'partials'));
		writeFileSync(
			join(dir, 'partials', 'index.html'),
			'<ol class="amber-auto-index">custom</ol>\n'
		);
		const theme = { name: 't', path: dir, assetBase: '/themes/t', manifest: {} };
		expect(readPartial(theme, 'index')).toBe('<ol class="amber-auto-index">custom</ol>\n');
		rmSync(dir, { recursive: true, force: true });
	});

	test('a discovered theme with no partials/index.html → falls back to the built-in', () => {
		const dir = mkdtempSync(join(tmpdir(), 'amber-theme-nopartial-'));
		const theme = { name: 't', path: dir, assetBase: '/themes/t', manifest: {} };
		expect(readPartial(theme, 'index')).toBe(BUILTIN_PARTIALS.index);
		rmSync(dir, { recursive: true, force: true });
	});

	test('defaults the kind to "index"', () => {
		expect(readPartial(BUILTIN_THEME)).toBe(BUILTIN_PARTIALS.index);
	});
});
