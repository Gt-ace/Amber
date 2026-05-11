import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

let GET: typeof import('./+server.ts').GET;
let root: string;

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), 'amber-asset-'));
	mkdirSync(join(root, 'themes', 'amber-default', 'fonts'), { recursive: true });
	writeFileSync(join(root, 'amber.toml'), 'amber_version = "0.2"\n');
	writeFileSync(join(root, 'index.md'), '# hi\n');
	writeFileSync(join(root, 'themes', 'amber-default', 'theme.css'), ':root{--x:1}');
	writeFileSync(join(root, 'themes', 'amber-default', 'fonts', 'x.woff2'), 'BINARY');
	process.env.AMBER_SPACE_PATH = root;
	GET = (await import('./+server.ts')).GET;
});

afterAll(async () => {
	const sp = (await import('$lib/server/space')).getSpace();
	sp.close();
	rmSync(root, { recursive: true, force: true });
});

const call = (name: string, file: string) =>
	GET({ params: { name, file } } as unknown as Parameters<typeof GET>[0]);

describe('theme asset route', () => {
	test('serves theme.css with text/css', async () => {
		const res = await call('amber-default', 'theme.css');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/css');
		expect(await res.text()).toBe(':root{--x:1}');
	});
	test('serves a nested font file with a font content-type', async () => {
		const res = await call('amber-default', 'fonts/x.woff2');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('font/woff2');
	});
	test('404 for a file that does not exist', async () => {
		const res = await call('amber-default', 'nope.css');
		expect(res.status).toBe(404);
	});
	test('404 (no traversal) for a path that escapes the theme dir', async () => {
		const res = await call('amber-default', '../../amber.toml');
		expect(res.status).toBe(404);
	});
	test('404 for an unknown theme name', async () => {
		const res = await call('does-not-exist', 'theme.css');
		expect(res.status).toBe(404);
	});
});
