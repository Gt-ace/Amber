import { describe, expect, test } from 'vitest';
import { describeThemeSource } from './themes';
import type { Theme } from '$lib/types/schema';

function themeMap(...names: string[]): Map<string, Theme> {
	const m = new Map<string, Theme>();
	for (const n of names) {
		m.set(n, { name: n, path: `/themes/${n}`, assetBase: `/themes/${n}`, manifest: {} });
	}
	return m;
}

describe('describeThemeSource', () => {
	test('declared + discovered → space-toml, not stale', () => {
		expect(describeThemeSource('amber-editorial', themeMap('amber-default', 'amber-editorial'))).toEqual(
			{ source: 'space-toml', staleThemeName: null }
		);
	});

	test('declared + not discovered → inherited + stale', () => {
		expect(describeThemeSource('ghost', themeMap('amber-default'))).toEqual({
			source: 'inherited',
			staleThemeName: 'ghost'
		});
	});

	test('undeclared → inherited, not stale', () => {
		expect(describeThemeSource(undefined, themeMap('amber-default'))).toEqual({
			source: 'inherited',
			staleThemeName: null
		});
	});

	test('declared against an empty discovered set → inherited + stale', () => {
		expect(describeThemeSource('amber-default', themeMap())).toEqual({
			source: 'inherited',
			staleThemeName: 'amber-default'
		});
	});
});
