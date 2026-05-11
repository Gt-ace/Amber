import { describe, expect, test } from 'vitest';
import { renderTemplate, escapeHtml } from './template.ts';

describe('escapeHtml', () => {
	test('escapes the HTML-significant characters', () => {
		expect(escapeHtml(`<a href="x">& '`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp; &#39;');
	});
	test('passes plain text through unchanged', () => {
		expect(escapeHtml('About')).toBe('About');
	});
});

describe('renderTemplate', () => {
	test('substitutes {{key}} with the escaped value', () => {
		expect(renderTemplate('<h1>{{title}}</h1>', { title: 'A & B' })).toBe('<h1>A &amp; B</h1>');
	});
	test('substitutes {{{key}}} raw', () => {
		expect(renderTemplate('<div>{{{html}}}</div>', { html: '<p>hi</p>' })).toBe(
			'<div><p>hi</p></div>'
		);
	});
	test('missing key renders empty', () => {
		expect(renderTemplate('[{{nope}}]', {})).toBe('[]');
	});
	test('section over a truthy non-array renders the block once', () => {
		expect(renderTemplate('{{#has}}yes{{/has}}', { has: true })).toBe('yes');
		expect(renderTemplate('{{#has}}yes{{/has}}', { has: '' })).toBe('');
		expect(renderTemplate('{{#has}}yes{{/has}}', {})).toBe('');
	});
	test('section over a non-empty array iterates with the element merged over the context', () => {
		const tpl = '{{#items}}<li><a href="{{href}}">{{label}}</a></li>{{/items}}';
		const out = renderTemplate(tpl, {
			items: [
				{ label: 'Home', href: '/' },
				{ label: 'About', href: '/about' }
			]
		});
		expect(out).toBe('<li><a href="/">Home</a></li><li><a href="/about">About</a></li>');
	});
	test('section over an empty array renders nothing', () => {
		expect(renderTemplate('{{#items}}x{{/items}}', { items: [] })).toBe('');
	});
	test('inverted section renders when the key is falsy/empty', () => {
		expect(renderTemplate('{{^body}}empty{{/body}}', { body: '' })).toBe('empty');
		expect(renderTemplate('{{^body}}empty{{/body}}', { body: 'x' })).toBe('');
		expect(renderTemplate('{{^items}}none{{/items}}', { items: [] })).toBe('none');
	});
	test('nested sections work', () => {
		const tpl = '{{#has_nav}}<ul>{{#nav}}<li>{{label}}</li>{{/nav}}</ul>{{/has_nav}}';
		expect(renderTemplate(tpl, { has_nav: true, nav: [{ label: 'a' }, { label: 'b' }] })).toBe(
			'<ul><li>a</li><li>b</li></ul>'
		);
		expect(renderTemplate(tpl, { has_nav: false, nav: [] })).toBe('');
	});
	test('whitespace and surrounding markup are preserved verbatim', () => {
		expect(renderTemplate('  {{a}}\n{{b}}  ', { a: '1', b: '2' })).toBe('  1\n2  ');
	});
	test('the content-slot HTML comment passes through and no substitution can forge it', () => {
		expect(
			renderTemplate('<main>{{x}}<!--amber:content--></main>', { x: '<!--amber:content-->' })
		).toBe('<main>&lt;!--amber:content--&gt;<!--amber:content--></main>');
	});
});
