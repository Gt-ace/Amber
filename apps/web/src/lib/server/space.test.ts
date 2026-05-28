/**
 * Tests for the server-side Space registry.
 *
 * The registry is keyed by absolute, normalised filesystem path. Zero-arg
 * `getSpace()` resolves to `AMBER_SPACE_PATH`; the explicit form
 * `getSpace(path)` allows callers (eventually, v0.5 routing) to address a
 * specific space. Single-space behaviour must remain unchanged: every
 * existing caller still uses the zero-arg form.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { getSpace, __resetRegistryForTests } from './space';

const EXAMPLE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url)).replace(
	/\/$/,
	''
);
const MESSY = fileURLToPath(new URL('../../../fixtures/messy-space/', import.meta.url)).replace(
	/\/$/,
	''
);

const originalEnv = process.env.AMBER_SPACE_PATH;

beforeEach(async () => {
	await __resetRegistryForTests();
});

afterEach(async () => {
	await __resetRegistryForTests();
	if (originalEnv === undefined) {
		delete process.env.AMBER_SPACE_PATH;
	} else {
		process.env.AMBER_SPACE_PATH = originalEnv;
	}
});

describe('getDiscoveryMode()', () => {
	afterEach(() => {
		delete process.env.AMBER_SPACES_DIR;
	});

	test('returns single-space when AMBER_SPACE_PATH is set', async () => {
		process.env.AMBER_SPACE_PATH = '/tmp/whatever';
		delete process.env.AMBER_SPACES_DIR;
		const { getDiscoveryMode } = await import('./space');
		expect(getDiscoveryMode()).toBe('single-space');
	});

	test('returns multi-space when AMBER_SPACES_DIR is set', async () => {
		delete process.env.AMBER_SPACE_PATH;
		process.env.AMBER_SPACES_DIR = '/tmp/whatever';
		const { getDiscoveryMode } = await import('./space');
		expect(getDiscoveryMode()).toBe('multi-space');
	});

	test('throws if neither is set', async () => {
		delete process.env.AMBER_SPACE_PATH;
		delete process.env.AMBER_SPACES_DIR;
		const { getDiscoveryMode } = await import('./space');
		expect(() => getDiscoveryMode()).toThrow();
	});

	test('throws if both are set', async () => {
		process.env.AMBER_SPACE_PATH = '/tmp/a';
		process.env.AMBER_SPACES_DIR = '/tmp/b';
		const { getDiscoveryMode } = await import('./space');
		expect(() => getDiscoveryMode()).toThrow();
	});
});

describe('getSpace() registry', () => {
	test('zero-arg form: two calls return the same Space instance', () => {
		process.env.AMBER_SPACE_PATH = EXAMPLE;

		const first = getSpace();
		const second = getSpace();

		expect(second).toBe(first);
		expect(first.root).toBe(path.resolve(EXAMPLE));
	});

	test('explicit form: different paths yield distinct Space instances', () => {
		const a = getSpace(EXAMPLE);
		const b = getSpace(MESSY);

		expect(a).not.toBe(b);
		expect(a.root).toBe(path.resolve(EXAMPLE));
		expect(b.root).toBe(path.resolve(MESSY));

		// Same path again returns the cached instance.
		const aAgain = getSpace(EXAMPLE);
		expect(aAgain).toBe(a);
	});

	test('default and explicit converge when paths are equivalent (trailing slash)', () => {
		process.env.AMBER_SPACE_PATH = EXAMPLE;

		const viaEnv = getSpace();
		const viaExplicitTrailing = getSpace(EXAMPLE + '/');

		expect(viaExplicitTrailing).toBe(viaEnv);
	});

	test('zero-arg with unset AMBER_SPACE_PATH throws unchanged message', () => {
		delete process.env.AMBER_SPACE_PATH;

		expect(() => getSpace()).toThrowError(
			'AMBER_SPACE_PATH is not set. Point it at your Amber space directory ' +
				'(e.g. AMBER_SPACE_PATH=apps/web/fixtures/example-space) and retry.'
		);
	});
});
