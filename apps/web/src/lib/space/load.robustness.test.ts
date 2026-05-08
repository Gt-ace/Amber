import { describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { load } from './load.ts';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/messy-space/', import.meta.url));

describe('messy-space', () => {
	test('a) leading UTF-8 BOM is stripped from raw before parsing', () => {
		const { space, warnings } = load(FIXTURE);
		const page = space.pages.get('/bom')!;
		expect(page).toBeDefined();
		expect(page.frontmatter.title).toBe('BOM file');
		// BOM must not survive into the body.
		expect(page.body.charCodeAt(0)).not.toBe(0xfeff);
		expect(page.body).toBe('Body after BOM.\n');
		// The contentHash is computed off the BOM-stripped raw, so it must be
		// 64 hex chars and stable.
		expect(page.contentHash).toMatch(/^[0-9a-f]{64}$/);
		// No warning should fire for this file.
		expect(warnings.find((w) => w.source === 'bom.md')).toBeUndefined();
	});

	test('b) CRLF line endings are normalized to LF in the body', () => {
		const { space, warnings } = load(FIXTURE);
		const page = space.pages.get('/crlf')!;
		expect(page).toBeDefined();
		expect(page.frontmatter.title).toBe('CRLF file');
		expect(page.body).not.toContain('\r');
		expect(page.body).toBe('First line.\nSecond line.\n');
		expect(warnings.find((w) => w.source === 'crlf.md')).toBeUndefined();
	});

	test('c) non-ASCII filename passes through to the URL unchanged', () => {
		const { space, warnings } = load(FIXTURE);
		const page = space.pages.get('/unicode-名前')!;
		expect(page).toBeDefined();
		expect(page.relativePath).toBe('unicode-名前.md');
		expect(page.frontmatter.title).toBe('名前のページ');
		expect(warnings.find((w) => w.source === 'unicode-名前.md')).toBeUndefined();
	});

	test('d) non-ASCII slug passes through to the URL unchanged', () => {
		const { space, warnings } = load(FIXTURE);
		const page = space.pages.get('/naïveté')!;
		expect(page).toBeDefined();
		expect(page.relativePath).toBe('unicode-slug.md');
		expect(page.frontmatter.slug).toBe('naïveté');
		expect(page.frontmatter.title).toBe('Naïveté');
		expect(warnings.find((w) => w.source === 'unicode-slug.md')).toBeUndefined();
	});

	test('e) zero-byte file loads with empty frontmatter and empty body', () => {
		const { space, warnings } = load(FIXTURE);
		const page = space.pages.get('/zero-byte')!;
		expect(page).toBeDefined();
		expect(page.frontmatter).toEqual({});
		expect(page.extra).toEqual({});
		expect(page.body).toBe('');
		expect(warnings.find((w) => w.source === 'zero-byte.md')).toBeUndefined();
	});

	test('f) a single ~100KB body line loads without throwing', () => {
		const { space, warnings } = load(FIXTURE);
		const page = space.pages.get('/long-line')!;
		expect(page).toBeDefined();
		expect(page.frontmatter.title).toBe('Long line');
		// The body is ~100k 'a's plus a trailing newline.
		expect(page.body.length).toBeGreaterThanOrEqual(100_000);
		expect(/^a{100000}\n?$/.test(page.body)).toBe(true);
		expect(warnings.find((w) => w.source === 'long-line.md')).toBeUndefined();
	});

	test('g) file with no frontmatter loads as plain markdown body', () => {
		const { space, warnings } = load(FIXTURE);
		const page = space.pages.get('/no-frontmatter')!;
		expect(page).toBeDefined();
		expect(page.frontmatter).toEqual({});
		expect(page.extra).toEqual({});
		expect(page.body).toBe('# Just a heading\n\nNo frontmatter at all here.\n');
		// Crucially: no parse error / no warning. No frontmatter is allowed.
		expect(warnings.find((w) => w.source === 'no-frontmatter.md')).toBeUndefined();
	});

	test('h) frontmatter with empty body produces Page.body === ""', () => {
		const { space, warnings } = load(FIXTURE);
		const page = space.pages.get('/empty-body')!;
		expect(page).toBeDefined();
		expect(page.frontmatter.title).toBe('Empty body');
		expect(page.body).toBe('');
		expect(warnings.find((w) => w.source === 'empty-body.md')).toBeUndefined();
	});

	test('i) unusual but valid YAML parses; nested objects land in extra', () => {
		const { space, warnings } = load(FIXTURE);
		const page = space.pages.get('/unusual-yaml')!;
		expect(page).toBeDefined();
		expect(page.frontmatter.title).toBe('Unusual YAML');
		// Multiline `|` block scalar lands as a single string with embedded LF.
		expect(page.frontmatter.description).toBe(
			'This is a multiline\nblock scalar description\nspanning three lines.\n'
		);
		// ISO date is preserved (smol/yaml's choice — we don't coerce it). The
		// loader's contract on `date` is "whatever YAML produced" — string or
		// Date, depending on the parser. Just assert it's defined and non-empty.
		expect(page.frontmatter.date).toBeDefined();
		// Nested object is not a known frontmatter key → goes into extra.
		expect(page.extra.meta).toEqual({
			author_handle: '@mira',
			nested: { depth: 2, flag: true }
		});
		expect(page.body).toBe('Body for unusual yaml.\n');
		expect(warnings.find((w) => w.source === 'unusual-yaml.md')).toBeUndefined();
	});

	test('messy-space loads with no warnings overall', () => {
		const { warnings } = load(FIXTURE);
		expect(warnings).toEqual([]);
	});
});
