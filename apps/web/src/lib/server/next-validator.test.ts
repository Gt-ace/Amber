import { describe, expect, test } from 'vitest';
import { validateNext } from './next-validator.ts';

describe('validateNext', () => {
	test('accepts a same-origin path', () => {
		expect(validateNext('/admin/edit/about')).toBe('/admin/edit/about');
		expect(validateNext('/admin')).toBe('/admin');
		expect(validateNext('/')).toBe('/');
	});

	test('falls back when missing', () => {
		expect(validateNext(null)).toBe('/admin');
		expect(validateNext(undefined)).toBe('/admin');
		expect(validateNext('')).toBe('/admin');
	});

	test('rejects protocol-relative URLs', () => {
		expect(validateNext('//evil.example.com/x')).toBe('/admin');
		expect(validateNext('//evil.example.com')).toBe('/admin');
	});

	test('rejects absolute URLs with a scheme', () => {
		expect(validateNext('https://evil.example.com/x')).toBe('/admin');
		expect(validateNext('http://evil.example.com/x')).toBe('/admin');
	});

	test('rejects pseudo-schemes after a slash', () => {
		expect(validateNext('/javascript:alert(1)')).toBe('/admin');
		expect(validateNext('/data:text/html,x')).toBe('/admin');
	});

	test('rejects backslash-prefixed paths', () => {
		// Some browsers normalize `/\evil` to `//evil`; reject.
		expect(validateNext('/\\evil.example.com')).toBe('/admin');
	});

	test('decodes once before validating', () => {
		// %2F%2F decodes to // — should be rejected.
		expect(validateNext('%2F%2Fevil.example.com')).toBe('/admin');
	});

	test('uses the supplied fallback', () => {
		expect(validateNext(null, '/home')).toBe('/home');
		expect(validateNext('https://evil', '/home')).toBe('/home');
	});

	test('returns fallback on malformed percent-encoding', () => {
		expect(validateNext('%E0%A4%A')).toBe('/admin');
	});
});
