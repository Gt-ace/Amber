import { describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { discoverThemes, resolveActiveTheme, readTemplate } from './themes.ts';
import { BUILTIN_THEME } from '$lib/theme/builtin';
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
	'theme.toml': 'name = "Pretty"\nversion = "1.0"\n[theme_color]\nlight = "#fff"\ndark = "#000"\n[footer]\nlabel = "Source"\nhref = "https://example.com"\n',
	'theme.css': ':root { --x: 1 }',
	'chrome.html': '<header></header><main><!--amber:content--></main>',
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
		const m = discoverThemes(root, log);
		rmSync(root, { recursive: true, force: true });
		return m;
	})();

	test('missing `theme` key → amber-default', () => {
		const m: AmberManifest = { amber_version: '0.2' };
		expect(resolveActiveTheme(themes, m, log).name).toBe('amber-default');
	});
	test('string `theme` → that theme', () => {
		const m: AmberManifest = { amber_version: '0.2', theme: 'other' };
		expect(resolveActiveTheme(themes, m, log).name).toBe('other');
	});
	test('object `theme = { name }` → that theme', () => {
		const m: AmberManifest = { amber_version: '0.2', theme: { name: 'other' } };
		expect(resolveActiveTheme(themes, m, log).name).toBe('other');
	});
	test('unknown theme name → falls back to amber-default (logged)', () => {
		const m: AmberManifest = { amber_version: '0.2', theme: 'nope' };
		expect(resolveActiveTheme(themes, m, log).name).toBe('amber-default');
	});
	test('no usable themes at all → BUILTIN_THEME', () => {
		const m: AmberManifest = { amber_version: '0.2', theme: 'nope' };
		expect(resolveActiveTheme(new Map(), m, log)).toBe(BUILTIN_THEME);
	});
});
