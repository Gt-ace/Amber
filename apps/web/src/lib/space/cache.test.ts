import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Space } from './space.ts';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

function copyFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), 'amber-cache-'));
	// Use shell `cp -r` instead of `node:fs.cpSync` — under bun's vitest
	// worker, cpSync drops the execute bit from directories, which makes
	// them untraversable.
	const src = FIXTURE.replace(/\/$/, '');
	execSync(`umask 022 && cp -r "${src}/." "${dir}/"`, { shell: '/bin/sh' });
	return dir;
}

describe('SpaceCache hydration', () => {
	let dir: string;

	beforeEach(() => {
		dir = copyFixture();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('cold start writes cache.db; same Space data round-trips through it', () => {
		const first = Space.load(dir);
		expect(existsSync(join(dir, '.amber', 'cache.db'))).toBe(true);
		const firstUrls = [...first.space.pages.keys()].sort();
		const firstWarningCodes = first.warnings.map((w) => w.code).sort();
		first.space.close();

		const second = Space.load(dir);
		const secondUrls = [...second.space.pages.keys()].sort();
		const secondWarningCodes = second.warnings.map((w) => w.code).sort();
		expect(secondUrls).toEqual(firstUrls);
		expect(secondWarningCodes).toEqual(firstWarningCodes);
		// And the manifest survived too.
		expect(second.space.manifest.amber_version).toBe('0.1');
		second.space.close();
	});

	test('cache hydrates without re-reading content files', () => {
		// First load populates the cache.
		const first = Space.load(dir);
		first.space.close();

		// Make every markdown file unreadable. If the second load tries to
		// read a content file, it'll throw EACCES; if it hydrates from cache,
		// it won't touch them.
		const targets = [
			'about.md',
			'index.md',
			'hello.md',
			'notes/2025-09-on-tea.md',
			'notes/unfinished-essay.md',
			'projects/index.md',
			'projects/amber.md',
			'projects/field-notes/index.md'
		];
		for (const t of targets) chmodSync(join(dir, t), 0o000);

		try {
			const second = Space.load(dir);
			expect([...second.space.pages.keys()].sort()).toEqual([
				'/',
				'/about',
				'/notes/2025-09-on-tea',
				'/notes/unfinished-essay',
				'/projects',
				'/projects/amber',
				'/projects/field-notes',
				'/say-hi'
			]);
			// Body of a page is round-tripped from cache, not from disk.
			expect(second.space.pages.get('/')!.body.length).toBeGreaterThan(0);
			second.space.close();
		} finally {
			for (const t of targets) chmodSync(join(dir, t), 0o644);
		}
	});

	test('mtime drift on a content file invalidates the cache', () => {
		const first = Space.load(dir);
		first.space.close();

		// Mutate a file — its mtime advances. The next load must fall through.
		const path = join(dir, 'about.md');
		writeFileSync(path, '---\ntitle: Different\n---\n\nDifferent body.');

		const second = Space.load(dir);
		expect(second.space.pages.get('/about')!.frontmatter.title).toBe('Different');
		expect(second.space.pages.get('/about')!.body.includes('Different body')).toBe(true);
		second.space.close();
	});

	test('manifest mtime drift invalidates the cache', () => {
		const first = Space.load(dir);
		first.space.close();

		// Touch the manifest with a slightly different content (renames a
		// nav label) — its mtime moves; cache must fall through.
		writeFileSync(join(dir, 'amber.toml'), `amber_version = "0.1"\n[site]\ntitle = "Renamed"\n`);

		const second = Space.load(dir);
		expect(second.space.manifest.site?.title).toBe('Renamed');
		second.space.close();
	});

	test('apply() persists incremental changes to cache', () => {
		const first = Space.load(dir);
		writeFileSync(join(dir, 'colophon.md'), '---\ntitle: Colophon\n---\n\nbody.');
		first.space.apply({ type: 'add', path: 'colophon.md' });
		first.space.close();

		// Reopen — must hydrate cleanly *and* see the new page (mtime check
		// will pass because the cache row's mtime matches the on-disk file).
		const second = Space.load(dir);
		expect(second.space.pages.has('/colophon')).toBe(true);
		expect(second.space.pages.get('/colophon')!.frontmatter.title).toBe('Colophon');
		second.space.close();
	});

	test('deleting cache.db is safe; next load rebuilds it from filesystem', () => {
		const first = Space.load(dir);
		first.space.close();
		rmSync(join(dir, '.amber', 'cache.db'), { force: true });
		// WAL/SHM siblings if present
		rmSync(join(dir, '.amber', 'cache.db-wal'), { force: true });
		rmSync(join(dir, '.amber', 'cache.db-shm'), { force: true });

		const second = Space.load(dir);
		expect(second.space.pages.size).toBe(8);
		expect(existsSync(join(dir, '.amber', 'cache.db'))).toBe(true);
		second.space.close();
	});
});
