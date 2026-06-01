import { describe, expect, test } from 'vitest';
import { validateThemePick } from './space-config-validate';
import type { Theme } from '$lib/types/schema';

function themeMap(...names: string[]): Map<string, Theme> {
	const m = new Map<string, Theme>();
	for (const n of names) m.set(n, { name: n, path: `/t/${n}`, assetBase: `/themes/${n}`, manifest: {} });
	return m;
}

describe('validateThemePick', () => {
	test('empty string → ok, theme undefined (use install default)', () => {
		expect(validateThemePick('', themeMap('amber-default'))).toEqual({ kind: 'ok', theme: undefined });
	});

	test('discovered name → ok with that theme', () => {
		expect(validateThemePick('amber-default', themeMap('amber-default'))).toEqual({
			kind: 'ok',
			theme: 'amber-default'
		});
	});

	test('undiscovered name → error', () => {
		expect(validateThemePick('ghost', themeMap('amber-default'))).toEqual({
			kind: 'error',
			code: 'theme_not_discovered',
			submitted: 'ghost'
		});
	});

	test('empty discovered set: a name errors, the empty sentinel still passes', () => {
		expect(validateThemePick('amber-default', themeMap())).toEqual({
			kind: 'error',
			code: 'theme_not_discovered',
			submitted: 'amber-default'
		});
		expect(validateThemePick('', themeMap())).toEqual({ kind: 'ok', theme: undefined });
	});
});
