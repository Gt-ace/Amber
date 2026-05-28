/**
 * Tests for `addSpace()` (v0.5 subsystem 5). Builds throwaway space
 * directories in os.tmpdir(), boots a minimal resolver index, and
 * asserts the swap took effect.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { __resetRegistryForTests } from './space';
import {
	setResolverIndex,
	__resetResolverIndexForTests
} from './resolver-index-holder';
import { setReroutePrefixes } from '$lib/reroute-prefixes';
import { setDefaultSlug } from '$lib/server/default-space';
import { buildResolverIndex } from './resolver-index';

let parentDir: string;

function writeSpace(slug: string, opts: { space?: string } = {}): string {
	const dir = join(parentDir, slug);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, 'amber.toml'), 'amber_version = "0.1"\n\n[site]\ntitle = "S"\n');
	writeFileSync(join(dir, 'index.md'), '# S\n');
	if (opts.space !== undefined) writeFileSync(join(dir, 'space.toml'), opts.space);
	return dir;
}

beforeEach(async () => {
	parentDir = mkdtempSync(join(tmpdir(), 'amber-add-'));
	process.env.AMBER_SPACES_DIR = parentDir;
	delete process.env.AMBER_SPACE_PATH;
	// Seed a minimal index so the holder is initialised.
	const empty = buildResolverIndex([], 'admin.test', 'http:').index;
	setResolverIndex(empty);
	setReroutePrefixes([]);
	setDefaultSlug(null);
});

afterEach(async () => {
	await __resetRegistryForTests();
	__resetResolverIndexForTests();
	rmSync(parentDir, { recursive: true, force: true });
	delete process.env.AMBER_SPACES_DIR;
});

describe('addSpace()', () => {
	test('loads the new space into the registry and updates the resolver index', async () => {
		const abs = writeSpace('alpha', { space: 'host = "alpha.test"\n' });
		const { addSpace, getRegistryEntries } = await import('./space');
		const { getResolverIndex } = await import('./resolver-index-holder');
		await addSpace(abs);
		expect(getRegistryEntries().some((e) => e.path === abs)).toBe(true);
		expect(getResolverIndex().byHost.get('alpha.test')).toBeDefined();
	});

	test('updates reroute-prefixes when the new space declares a prefix', async () => {
		const abs = writeSpace('beta', { space: 'prefix = "/beta"\n' });
		const { addSpace } = await import('./space');
		const { reroutePrefixes } = await import('$lib/reroute-prefixes');
		await addSpace(abs);
		expect(reroutePrefixes()).toContain('/beta');
	});

	test('updates default-slug when the new space declares default', async () => {
		const abs = writeSpace('gamma', { space: 'default = true\n' });
		const { addSpace } = await import('./space');
		const { getDefaultSlug } = await import('$lib/server/default-space');
		await addSpace(abs);
		expect(getDefaultSlug()).toBe('gamma');
	});

	test('throws if the path is already in the registry', async () => {
		const abs = writeSpace('delta');
		const { addSpace } = await import('./space');
		await addSpace(abs);
		await expect(addSpace(abs)).rejects.toThrow(/already/i);
	});

	test('throws and leaves runtime state unchanged when the space fails to load', async () => {
		const abs = join(parentDir, 'corrupt');
		mkdirSync(abs);
		writeFileSync(join(abs, 'amber.toml'), 'this is not toml = = =');
		const { addSpace, getRegistryEntries } = await import('./space');
		const { getResolverIndex } = await import('./resolver-index-holder');
		const sizeBefore = getRegistryEntries().length;
		const hostsBefore = [...getResolverIndex().byHost.keys()];
		await expect(addSpace(abs)).rejects.toThrow();
		expect(getRegistryEntries().length).toBe(sizeBefore);
		expect([...getResolverIndex().byHost.keys()]).toEqual(hostsBefore);
	});

	test('drops conflicting default flag from the new space (defense-in-depth)', async () => {
		const a = writeSpace('one', { space: 'default = true\n' });
		const b = writeSpace('two', { space: 'default = true\n' });
		const { addSpace } = await import('./space');
		const { getDefaultSlug } = await import('$lib/server/default-space');
		await addSpace(a);
		await addSpace(b);
		// First-wins: `one` remains the default. `two` loaded but its
		// default flag was dropped via the buildResolverIndex warning.
		expect(getDefaultSlug()).toBe('one');
	});
});
