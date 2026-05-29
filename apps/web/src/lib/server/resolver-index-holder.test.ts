import { describe, expect, test, beforeEach } from 'vitest';
import {
	setResolverIndex,
	getResolverIndex,
	__resetResolverIndexForTests
} from './resolver-index-holder';
import type { ResolverIndex } from './resolver';
import type { Space } from '$lib/space/space';

beforeEach(() => {
	__resetResolverIndexForTests();
});

function fakeIndex(): ResolverIndex<Space> {
	return {
		adminHost: 'admin.test',
		adminScheme: 'https:',
		byHost: new Map(),
		prefixes: [],
		default: null
	};
}

describe('resolver-index-holder', () => {
	test('setResolverIndex → getResolverIndex round-trips', () => {
		const idx = fakeIndex();
		setResolverIndex(idx);
		expect(getResolverIndex()).toBe(idx);
	});

	test('getResolverIndex throws before set', () => {
		expect(() => getResolverIndex()).toThrow(/not initialised/i);
	});

	test('setResolverIndex overwrites', () => {
		const a = fakeIndex();
		const b = fakeIndex();
		setResolverIndex(a);
		setResolverIndex(b);
		expect(getResolverIndex()).toBe(b);
	});
});
