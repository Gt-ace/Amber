import { describe, expect, test } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readSpaceConfig } from './config.ts';

function scratch(): string {
	return mkdtempSync(join(tmpdir(), 'amber-space-config-'));
}

describe('readSpaceConfig', () => {
	test('returns null config + no warnings when space.toml is absent', () => {
		const root = scratch();
		try {
			const { config, warnings } = readSpaceConfig(root);
			expect(config).toBeNull();
			expect(warnings).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('parses theme = "foo" into { theme: "foo" }', () => {
		const root = scratch();
		try {
			writeFileSync(join(root, 'space.toml'), 'theme = "foo"\n');
			const { config, warnings } = readSpaceConfig(root);
			expect(config).toEqual({ theme: 'foo' });
			expect(warnings).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('an empty space.toml returns {} with no warnings', () => {
		const root = scratch();
		try {
			writeFileSync(join(root, 'space.toml'), '');
			const { config, warnings } = readSpaceConfig(root);
			expect(config).toEqual({});
			expect(warnings).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('malformed TOML emits space_config_invalid', () => {
		const root = scratch();
		try {
			writeFileSync(join(root, 'space.toml'), 'this = = not toml');
			const { config, warnings } = readSpaceConfig(root);
			expect(config).toBeNull();
			expect(warnings).toHaveLength(1);
			expect(warnings[0].code).toBe('space_config_invalid');
			expect(warnings[0].source).toBe('space.toml');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('a non-string `theme` emits space_config_invalid and drops the field', () => {
		const root = scratch();
		try {
			writeFileSync(join(root, 'space.toml'), 'theme = 42\n');
			const { config, warnings } = readSpaceConfig(root);
			expect(config).toEqual({});
			expect(warnings).toHaveLength(1);
			expect(warnings[0].code).toBe('space_config_invalid');
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});

	test('forward-compat: extra table keys are ignored, no warnings', () => {
		const root = scratch();
		try {
			writeFileSync(join(root, 'space.toml'), '[[bad]]\n');
			const { config, warnings } = readSpaceConfig(root);
			expect(config).toEqual({});
			expect(warnings).toEqual([]);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});

function tmpSpaceWith(contents: string): string {
	const dir = mkdtempSync(join(tmpdir(), 'amber-config-'));
	writeFileSync(join(dir, 'space.toml'), contents);
	return dir;
}

describe('readSpaceConfig — routing fields', () => {
	test('reads host as a string', () => {
		const dir = tmpSpaceWith(`host = "amber.example.com"\n`);
		try {
			const { config, warnings } = readSpaceConfig(dir);
			expect(warnings).toEqual([]);
			expect(config?.host).toBe('amber.example.com');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('reads prefix as a string', () => {
		const dir = tmpSpaceWith(`prefix = "/scratch"\n`);
		try {
			const { config, warnings } = readSpaceConfig(dir);
			expect(warnings).toEqual([]);
			expect(config?.prefix).toBe('/scratch');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('reads default as a boolean', () => {
		const dir = tmpSpaceWith(`default = true\n`);
		try {
			const { config, warnings } = readSpaceConfig(dir);
			expect(warnings).toEqual([]);
			expect(config?.default).toBe(true);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('host as non-string warns with space_config_invalid', () => {
		const dir = tmpSpaceWith(`host = 42\n`);
		try {
			const { config, warnings } = readSpaceConfig(dir);
			expect(config?.host).toBeUndefined();
			expect(warnings).toHaveLength(1);
			expect(warnings[0].code).toBe('space_config_invalid');
			expect(warnings[0].message).toMatch(/host/);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('default as non-boolean warns with space_config_invalid', () => {
		const dir = tmpSpaceWith(`default = "yes"\n`);
		try {
			const { config, warnings } = readSpaceConfig(dir);
			expect(config?.default).toBeUndefined();
			expect(warnings[0].code).toBe('space_config_invalid');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	test('co-existing theme + host parses both', () => {
		const dir = tmpSpaceWith(`theme = "amber-editorial"\nhost = "a.example.com"\n`);
		try {
			const { config } = readSpaceConfig(dir);
			expect(config?.theme).toBe('amber-editorial');
			expect(config?.host).toBe('a.example.com');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
