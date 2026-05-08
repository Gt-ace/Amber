import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Database } from 'bun:sqlite';
import { Space } from './space.ts';
import { SpaceCache } from './cache.ts';

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

	test('renders table round-trips html keyed by content hash', () => {
		const cache = new SpaceCache(dir);
		expect(cache.getRender('deadbeef')).toBeNull();
		cache.putRender('deadbeef', '<p>hi</p>');
		expect(cache.getRender('deadbeef')).toBe('<p>hi</p>');
		// Re-putting the same hash is a no-op (ON CONFLICT DO NOTHING).
		cache.putRender('deadbeef', '<p>different</p>');
		expect(cache.getRender('deadbeef')).toBe('<p>hi</p>');
		cache.close();
	});

	test('renders cache survives across SpaceCache instances', () => {
		const a = new SpaceCache(dir);
		a.putRender('abc123', '<p>persisted</p>');
		a.close();

		const b = new SpaceCache(dir);
		expect(b.getRender('abc123')).toBe('<p>persisted</p>');
		b.close();
	});

	test('schema bump from v1 wipes cache cleanly', () => {
		// Hand-craft a v1 cache.db (no renders table, schema_version='1').
		// Opening it under the new code must trigger the wipe path and
		// recreate the renders table.
		const dbPath = join(dir, '.amber', 'cache.db');
		execSync(`mkdir -p "${join(dir, '.amber')}"`, { shell: '/bin/sh' });
		// The fixture might carry a stray cache.db from earlier ad-hoc runs;
		// `cp -r` copies it. Start from a clean slate so we control schema.
		rmSync(dbPath, { force: true });
		rmSync(dbPath + '-wal', { force: true });
		rmSync(dbPath + '-shm', { force: true });
		const raw = new Database(dbPath, { create: true });
		raw.exec(`
			CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
			CREATE TABLE pages (
				rel TEXT PRIMARY KEY, url TEXT NOT NULL, frontmatter TEXT NOT NULL,
				extra TEXT NOT NULL, body TEXT NOT NULL, mtime REAL NOT NULL,
				content_hash TEXT NOT NULL
			);
			CREATE TABLE warnings (code TEXT NOT NULL, source TEXT, message TEXT NOT NULL);
			INSERT INTO meta(key, value) VALUES ('schema_version', '1');
			INSERT INTO meta(key, value) VALUES ('manifest_mtime', '99999');
			INSERT INTO pages(rel, url, frontmatter, extra, body, mtime, content_hash)
				VALUES ('stale.md', '/stale', '{}', '{}', 'stale', 1, 'h');
		`);
		raw.close();

		// Now open with the current code. Schema mismatch → wipe.
		const cache = new SpaceCache(dir);
		// renders table now exists and is empty.
		expect(cache.getRender('h')).toBeNull();
		cache.putRender('h', '<p>fresh</p>');
		expect(cache.getRender('h')).toBe('<p>fresh</p>');
		cache.close();

		// And the stale meta/pages rows are gone — the next Space.load() will
		// rebuild from the filesystem rather than hydrating the bogus row.
		const result = Space.load(dir);
		expect(result.space.pages.has('/stale')).toBe(false);
		expect(result.space.pages.has('/about')).toBe(true);
		result.space.close();
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

describe('SpaceCache.vacuum', () => {
	let dir: string;

	beforeEach(() => {
		dir = copyFixture();
	});

	afterEach(() => {
		rmSync(dir, { recursive: true, force: true });
	});

	test('empty active set deletes every render row', () => {
		const cache = new SpaceCache(dir);
		cache.putRender('aaa', '<p>a</p>');
		cache.putRender('bbb', '<p>b</p>');
		cache.putRender('ccc', '<p>c</p>');

		const removed = cache.vacuum(new Set());
		expect(removed).toBe(3);
		expect(cache.getRender('aaa')).toBeNull();
		expect(cache.getRender('bbb')).toBeNull();
		expect(cache.getRender('ccc')).toBeNull();
		cache.close();
	});

	test('full active set deletes nothing', () => {
		const cache = new SpaceCache(dir);
		cache.putRender('aaa', '<p>a</p>');
		cache.putRender('bbb', '<p>b</p>');

		const removed = cache.vacuum(new Set(['aaa', 'bbb']));
		expect(removed).toBe(0);
		expect(cache.getRender('aaa')).toBe('<p>a</p>');
		expect(cache.getRender('bbb')).toBe('<p>b</p>');
		cache.close();
	});

	test('partial overlap deletes the orphaned subset', () => {
		const cache = new SpaceCache(dir);
		cache.putRender('keep1', '<p>k1</p>');
		cache.putRender('keep2', '<p>k2</p>');
		cache.putRender('orphan', '<p>o</p>');

		const removed = cache.vacuum(new Set(['keep1', 'keep2']));
		expect(removed).toBe(1);
		expect(cache.getRender('keep1')).toBe('<p>k1</p>');
		expect(cache.getRender('keep2')).toBe('<p>k2</p>');
		expect(cache.getRender('orphan')).toBeNull();
		cache.close();
	});

	test('vacuum on an empty renders table is a no-op', () => {
		const cache = new SpaceCache(dir);
		expect(cache.vacuum(new Set())).toBe(0);
		expect(cache.vacuum(new Set(['anything']))).toBe(0);
		cache.close();
	});
});
