import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { getSharedThemes, sharedThemesDir, __resetSharedThemesForTests } from './shared-themes.ts';

const TEMPLATES = {
	'theme.toml': 'name = "Shared"\nversion = "1.0"\n',
	'theme.css': ':root{--x:1}',
	'chrome.html': '<header></header><!--amber:content--><footer></footer>',
	'page.html': '<article>{{{html}}}</article>',
	'error.html': '<p>{{status}}</p>'
};

function writeTheme(dir: string, name: string): void {
	const d = join(dir, name);
	mkdirSync(d, { recursive: true });
	for (const [f, c] of Object.entries(TEMPLATES)) writeFileSync(join(d, f), c);
}

let prevEnv: string | undefined;
let work: string;

beforeEach(() => {
	prevEnv = process.env.AMBER_BUNDLED_THEMES_DIR;
	work = mkdtempSync(join(tmpdir(), 'amber-shared-'));
	__resetSharedThemesForTests();
});

afterEach(() => {
	if (prevEnv === undefined) delete process.env.AMBER_BUNDLED_THEMES_DIR;
	else process.env.AMBER_BUNDLED_THEMES_DIR = prevEnv;
	__resetSharedThemesForTests();
	rmSync(work, { recursive: true, force: true });
});

describe('shared-themes', () => {
	test('sharedThemesDir honors AMBER_BUNDLED_THEMES_DIR when set', () => {
		process.env.AMBER_BUNDLED_THEMES_DIR = work;
		expect(sharedThemesDir()).toBe(work);
	});

	test('discovers complete themes from the bundled dir', () => {
		writeTheme(work, 'amber-default');
		writeTheme(work, 'amber-brand');
		process.env.AMBER_BUNDLED_THEMES_DIR = work;
		const themes = getSharedThemes();
		expect([...themes.keys()].sort()).toEqual(['amber-brand', 'amber-default']);
		expect(themes.get('amber-default')!.path).toBe(join(work, 'amber-default'));
		expect(themes.get('amber-default')!.assetBase).toBe('/themes/amber-default');
	});

	test('missing bundled dir → empty map, no throw', () => {
		process.env.AMBER_BUNDLED_THEMES_DIR = join(work, 'does-not-exist');
		expect(getSharedThemes().size).toBe(0);
	});

	test('memoizes: a second call returns the same instance until reset', () => {
		writeTheme(work, 'amber-default');
		process.env.AMBER_BUNDLED_THEMES_DIR = work;
		const first = getSharedThemes();
		const second = getSharedThemes();
		expect(second).toBe(first);
		__resetSharedThemesForTests();
		const third = getSharedThemes();
		expect(third).not.toBe(first);
	});
});
