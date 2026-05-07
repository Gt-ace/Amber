import { describe, expect, test } from 'vitest';
import { render } from './render.ts';

describe('render(markdown)', () => {
	test('renders CommonMark headings, paragraphs, lists', () => {
		const html = render('# Title\n\nA paragraph.\n\n- one\n- two\n');
		expect(html).toContain('<h1>Title</h1>');
		expect(html).toContain('<p>A paragraph.</p>');
		expect(html).toContain('<ul>');
		expect(html).toContain('<li>one</li>');
		expect(html).toContain('<li>two</li>');
	});

	test('renders inline emphasis and code', () => {
		const html = render('This is **bold**, *italic*, and `code`.');
		expect(html).toContain('<strong>bold</strong>');
		expect(html).toContain('<em>italic</em>');
		expect(html).toContain('<code>code</code>');
	});

	test('renders code blocks with language fence', () => {
		const html = render('```js\nconst x = 1;\n```\n');
		// Vanilla CommonMark: language fence shows up as a class on <code>.
		// No syntax highlighting plugin this sprint — the class is metadata only.
		expect(html).toContain('<pre>');
		expect(html).toContain('<code class="language-js">');
		expect(html).toContain('const x = 1;');
	});

	test('renders links with href', () => {
		const html = render('See [the docs](/docs/intro) for more.');
		expect(html).toContain('<a href="/docs/intro">the docs</a>');
	});

	test('linkifies bare URLs', () => {
		const html = render('Visit https://example.com today.');
		expect(html).toContain('<a href="https://example.com">https://example.com</a>');
	});

	test('escapes raw HTML — html:false is enforced', () => {
		const html = render('<script>alert(1)</script>\n\nHello.');
		// The script tag must be escaped, not embedded as live HTML.
		expect(html).not.toContain('<script>');
		expect(html).toContain('&lt;script&gt;');
		expect(html).toContain('alert(1)');
	});

	test('escapes raw HTML inside paragraphs too', () => {
		const html = render('Some <b>bold</b> text.');
		expect(html).not.toContain('<b>');
		expect(html).toContain('&lt;b&gt;');
	});

	test('typographer is off — no smart-quote / dash / ellipsis substitution', () => {
		const html = render(`"hello" -- world ...`);
		// With typographer: true, markdown-it would substitute curly quotes,
		// an en-dash, and a single ellipsis character. We want output to be
		// a deterministic function of input bytes for cache stability — so
		// none of those substitutions should occur.
		expect(html).toContain('--');
		expect(html).toContain('...');
		expect(html).not.toContain('“'); // left curly double-quote
		expect(html).not.toContain('”'); // right curly double-quote
		expect(html).not.toContain('–'); // en-dash
		expect(html).not.toContain('…'); // ellipsis
		// Quote characters themselves are HTML-escaped (`&quot;`), but they
		// remain *straight* quotes — no &ldquo;/&rdquo; entities.
		expect(html).not.toContain('&ldquo;');
		expect(html).not.toContain('&rdquo;');
		expect(html).not.toContain('&ndash;');
		expect(html).not.toContain('&hellip;');
	});

	test('is deterministic — same input produces identical output', () => {
		const md = '# Hello\n\nA paragraph with [a link](/x) and `code`.\n';
		const a = render(md);
		const b = render(md);
		const c = render(md);
		expect(a).toBe(b);
		expect(b).toBe(c);
	});

	test('empty input yields empty output', () => {
		expect(render('')).toBe('');
	});
});
