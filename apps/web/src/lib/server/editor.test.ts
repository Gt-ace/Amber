import { describe, expect, test } from 'vitest';
import { hashContent, splitRaw, recombine, reserializeFrontmatter } from './editor.ts';

describe('hashContent()', () => {
	test('is a stable 64-char hex SHA-256', () => {
		const h = hashContent('hello\n');
		expect(h).toMatch(/^[0-9a-f]{64}$/);
		expect(hashContent('hello\n')).toBe(h);
	});

	test('differs when content differs', () => {
		expect(hashContent('a')).not.toBe(hashContent('b'));
	});
});

describe('splitRaw()', () => {
	test('splits a file with frontmatter, preserving the block verbatim', () => {
		const raw = '---\ntitle: Hi\n---\n\nBody text\n';
		const { fmBlock, fmInner, body } = splitRaw(raw);
		expect(fmBlock).toBe('---\ntitle: Hi\n---\n');
		expect(fmInner).toBe('title: Hi');
		expect(body).toBe('\nBody text\n');
	});

	test('returns empty fmBlock when there is no frontmatter', () => {
		const { fmBlock, fmInner, body } = splitRaw('Just a body\n');
		expect(fmBlock).toBe('');
		expect(fmInner).toBe('');
		expect(body).toBe('Just a body\n');
	});

	test('does not normalize CRLF — bytes are verbatim', () => {
		const raw = '---\r\ntitle: Hi\r\n---\r\nBody\r\n';
		const { fmBlock, body } = splitRaw(raw);
		expect(fmBlock).toBe('---\r\ntitle: Hi\r\n---\r\n');
		expect(body).toBe('Body\r\n');
	});
});

describe('recombine()', () => {
	test('joins a verbatim block and body with exactly one newline', () => {
		const out = recombine('---\ntitle: Hi\n---\n', '\n\nBody\n');
		expect(out).toBe('---\ntitle: Hi\n---\nBody\n');
	});

	test('inserts the edge newline when the block has none', () => {
		const out = recombine('---\ntitle: Hi\n---', 'Body\n');
		expect(out).toBe('---\ntitle: Hi\n---\nBody\n');
	});

	test('with an empty block returns the body unchanged', () => {
		expect(recombine('', 'Body only\n')).toBe('Body only\n');
	});
});

describe('reserializeFrontmatter()', () => {
	test('applies edits and preserves every other key', () => {
		const block = reserializeFrontmatter(
			{ title: 'Old', description: 'kept', auto_index: { path: 'x' } },
			{ title: 'New', draft: false, date: '2026-05-19' }
		);
		expect(block).toMatch(/^---\n/);
		expect(block).toMatch(/\n---\n$/);
		expect(block).toContain('title: New');
		expect(block).toContain('description: kept');
		expect(block).toContain('date: 2026-05-19');
		expect(block).toContain('auto_index:');
	});

	test('draft true is written, draft false is omitted', () => {
		expect(reserializeFrontmatter({}, { draft: true })).toContain('draft: true');
		expect(reserializeFrontmatter({ draft: true }, { draft: false })).not.toContain('draft');
	});

	test('an empty-string title or date clears the key', () => {
		const block = reserializeFrontmatter({ title: 'Old', date: '2020-01-01' }, { title: '', date: '' });
		expect(block).not.toContain('title');
		expect(block).not.toContain('date');
	});
});
