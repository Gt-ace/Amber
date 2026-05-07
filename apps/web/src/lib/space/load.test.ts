import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { load } from './load.ts';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

describe('load(spacePath)', () => {
	test('parses the example-space fixture', () => {
		const { space, warnings } = load(FIXTURE);

		// Manifest is parsed end-to-end
		expect(space.manifest.amber_version).toBe('0.1');
		expect(space.manifest.site?.title).toBe('Mira Halden');
		expect(space.manifest.site?.language).toBe('en');

		// Page index — keys are leading-slash, no-trailing, "/" for root.
		expect([...space.pages.keys()].sort()).toEqual([
			'/',
			'/about',
			'/notes/2025-09-on-tea',
			'/notes/unfinished-essay',
			'/projects',
			'/projects/amber',
			'/projects/field-notes',
			'/say-hi'
		]);

		// Root index → "/"
		const root = space.pages.get('/')!;
		expect(root.relativePath).toBe('index.md');
		expect(root.frontmatter.title).toBe('Mira Halden');
		expect(root.body.trimStart().startsWith('I draw things')).toBe(true);
		// Frontmatter block is stripped from body
		expect(root.body.includes('title: Mira Halden')).toBe(false);

		// Folder-with-index → /projects (no trailing slash)
		const projects = space.pages.get('/projects')!;
		expect(projects.relativePath).toBe('projects/index.md');

		// Nested folder-with-index
		const fieldNotes = space.pages.get('/projects/field-notes')!;
		expect(fieldNotes.relativePath).toBe('projects/field-notes/index.md');

		// slug: replaces filename segment, not parents
		const sayHi = space.pages.get('/say-hi')!;
		expect(sayHi.relativePath).toBe('hello.md');
		expect(sayHi.frontmatter.slug).toBe('say-hi');

		// Drafts ARE in the index — consumers filter, loader produces.
		const draft = space.pages.get('/notes/unfinished-essay')!;
		expect(draft.frontmatter.draft).toBe(true);

		// Body is raw markdown — no HTML rendering
		expect(projects.body).toContain('![A pencil sketch');
		expect(projects.body).not.toContain('<img');

		// Reserved-prefix dirs are silently skipped (no Page entries, no warnings).
		expect(space.pages.has('/_drafts/scratch')).toBe(false);
		expect(space.pages.has('/_internal/note')).toBe(false);
		expect(space.pages.has('/.scratch/note')).toBe(false);
		// themes/ is reserved at the top level
		for (const k of space.pages.keys()) {
			expect(k.startsWith('/themes')).toBe(false);
		}

		// Non-markdown files are not in the page index
		for (const k of space.pages.keys()) {
			expect(k.endsWith('.png')).toBe(false);
		}

		// Frontmatter typed fields are parsed
		const onTea = space.pages.get('/notes/2025-09-on-tea')!;
		expect(onTea.frontmatter.tags).toEqual(['notes', 'habits']);
		expect(onTea.frontmatter.date).toBe('2025-09-14');
		expect(onTea.frontmatter.layout).toBe('post');

		// Each page has mtime + contentHash populated
		for (const p of space.pages.values()) {
			expect(typeof p.mtime).toBe('number');
			expect(p.mtime).toBeGreaterThan(0);
			expect(p.contentHash).toMatch(/^[0-9a-f]{64}$/);
			expect(p.filePath.endsWith(p.relativePath)).toBe(true);
		}

		// Reconciled nav: missing + reserved entries dropped, order preserved.
		expect(space.nav).toHaveLength(5);
		expect(space.nav[0]).toMatchObject({ kind: 'page', label: 'About', url: '/about' });
		expect(space.nav[1]).toMatchObject({ kind: 'page', label: 'Projects', url: '/projects' });
		expect(space.nav[2]).toMatchObject({ kind: 'page', label: 'Say hi', url: '/say-hi' });
		expect(space.nav[3]).toMatchObject({
			kind: 'page',
			label: 'On tea',
			url: '/notes/2025-09-on-tea'
		});
		expect(space.nav[4]).toEqual({
			kind: 'external',
			label: 'Mastodon',
			url: 'https://merveilles.town/@mira'
		});
		// Resolved leaves carry the actual Page object so themes don't re-derive.
		if (space.nav[0].kind === 'page') {
			expect(space.nav[0].page).toBe(space.pages.get('/about'));
		}

		// Redirects compiled into a Map, normalized form.
		expect(space.redirects.get('/old-portfolio')).toBe('/projects');
		expect(space.redirects.get('/blog')).toBe('/notes');

		// Warnings: exactly the two the fixture is designed to trigger.
		const codes = warnings.map((w) => w.code).sort();
		expect(codes).toEqual(['manifest_nav_missing_target', 'reserved_name_in_content']);
		const missing = warnings.find((w) => w.code === 'manifest_nav_missing_target')!;
		expect(missing.source).toBe('talks.md');
		const reserved = warnings.find((w) => w.code === 'reserved_name_in_content')!;
		expect(reserved.source).toBe('_drafts/scratch.md');

		// space.warnings mirrors the returned warnings array.
		expect(space.warnings).toEqual(warnings);

		// space.root is the resolved absolute path
		expect(space.root.length).toBeGreaterThan(0);
	});

	test('does not rewrite amber.toml on disk', () => {
		const manifestPath = fileURLToPath(new URL('amber.toml', new URL(FIXTURE, 'file://')));
		const before = readFileSync(manifestPath);
		load(FIXTURE);
		const after = readFileSync(manifestPath);
		expect(after.equals(before)).toBe(true);
	});
});
