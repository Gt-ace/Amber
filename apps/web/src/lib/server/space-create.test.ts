import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';
import { createSpace } from './space-create';

let parentDir: string;

beforeEach(() => {
	parentDir = mkdtempSync(join(tmpdir(), 'amber-write-'));
});

afterEach(() => {
	try {
		chmodSync(parentDir, 0o755);
	} catch {
		/* best-effort */
	}
	rmSync(parentDir, { recursive: true, force: true });
});

describe('createSpace()', () => {
	test('host routing — writes amber.toml, space.toml, index.md with the right contents', async () => {
		const r = await createSpace({
			parentDir,
			input: { slug: 'a', title: 'Alpha', routing: { kind: 'host', host: 'alpha.test' } }
		});
		expect(r.kind).toBe('ok');
		const dir = join(parentDir, 'a');
		const amber = readFileSync(join(dir, 'amber.toml'), 'utf8');
		const space = readFileSync(join(dir, 'space.toml'), 'utf8');
		const index = readFileSync(join(dir, 'index.md'), 'utf8');
		expect(parseToml(amber)).toEqual({
			amber_version: '0.1',
			site: { title: 'Alpha' }
		});
		expect(parseToml(space)).toEqual({ host: 'alpha.test' });
		expect(index).toContain('# Alpha');
		expect(index).toContain('title: "Alpha"');
	});

	test('prefix routing — space.toml carries prefix', async () => {
		await createSpace({
			parentDir,
			input: { slug: 'b', title: 'Beta', routing: { kind: 'prefix', prefix: '/beta' } }
		});
		const space = readFileSync(join(parentDir, 'b', 'space.toml'), 'utf8');
		expect(parseToml(space)).toEqual({ prefix: '/beta' });
	});

	test('default routing — space.toml carries default = true', async () => {
		await createSpace({
			parentDir,
			input: { slug: 'c', title: 'C', routing: { kind: 'default' } }
		});
		const space = readFileSync(join(parentDir, 'c', 'space.toml'), 'utf8');
		expect(parseToml(space)).toEqual({ default: true });
	});

	test('admin-only routing — space.toml is NOT written', async () => {
		await createSpace({
			parentDir,
			input: { slug: 'd', title: 'D', routing: { kind: 'admin-only' } }
		});
		expect(existsSync(join(parentDir, 'd', 'amber.toml'))).toBe(true);
		expect(existsSync(join(parentDir, 'd', 'space.toml'))).toBe(false);
		expect(existsSync(join(parentDir, 'd', 'index.md'))).toBe(true);
	});

	test('TOML escape: title with quote and backslash round-trips through parser', async () => {
		const tricky = 'A "quoted" \\backslash\\ title';
		await createSpace({
			parentDir,
			input: { slug: 'e', title: tricky, routing: { kind: 'admin-only' } }
		});
		const parsed = parseToml(readFileSync(join(parentDir, 'e', 'amber.toml'), 'utf8')) as {
			site: { title: string };
		};
		expect(parsed.site.title).toBe(tricky);
	});

	test('dir_already_exists when target slug pre-exists', async () => {
		mkdirSync(join(parentDir, 'taken'));
		const r = await createSpace({
			parentDir,
			input: { slug: 'taken', title: 'T', routing: { kind: 'admin-only' } }
		});
		expect(r.kind).toBe('error');
		if (r.kind === 'error') expect(r.code).toBe('dir_already_exists');
	});

	// Root bypasses chmod restrictions, so the read-only parent doesn't
	// actually block mkdir when tests run as root (e.g. inside a default
	// Docker container without USER). Skip the case rather than mark it
	// as flaky.
	const isRoot = process.getuid?.() === 0;
	test.skipIf(isRoot)('permission_denied surfaces from a read-only parent', async () => {
		chmodSync(parentDir, 0o555);
		const r = await createSpace({
			parentDir,
			input: { slug: 'x', title: 'X', routing: { kind: 'admin-only' } }
		});
		expect(r.kind).toBe('error');
		if (r.kind === 'error') expect(r.code).toBe('permission_denied');
		// parent must stay untouched
		chmodSync(parentDir, 0o755);
	});

	test('rollback: on a write failure mid-sequence the directory is removed', async () => {
		const r = await createSpace({
			parentDir,
			input: { slug: 'roll', title: 'R', routing: { kind: 'host', host: 'r.test' } },
			__forceFailAfter: 'amber'
		});
		expect(r.kind).toBe('error');
		expect(existsSync(join(parentDir, 'roll'))).toBe(false);
	});
});
