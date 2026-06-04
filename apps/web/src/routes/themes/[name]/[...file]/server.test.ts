import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { __resetSharedThemesForTests } from '$lib/server/shared-themes';

let GET: typeof import('./+server.ts').GET;
let root: string;
// Cached resolved space — see the page.test.ts twin for context. The handler
// now reads `event.locals.space`; in production `hooks.server.ts` populates
// it, so the unit test mirrors that.
let testSpace: import('$lib/space/space').Space;

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), 'amber-asset-'));
	mkdirSync(join(root, 'themes', 'amber-default', 'fonts'), { recursive: true });
	writeFileSync(join(root, 'amber.toml'), 'amber_version = "0.2"\n');
	writeFileSync(join(root, 'index.md'), '# hi\n');
	writeFileSync(join(root, 'themes', 'amber-default', 'theme.css'), ':root{--x:1}');
	writeFileSync(join(root, 'themes', 'amber-default', 'theme.js'), 'console.log(1)');
	writeFileSync(join(root, 'themes', 'amber-default', 'fonts', 'x.woff2'), 'BINARY');
	process.env.AMBER_SPACE_PATH = root;
	GET = (await import('./+server.ts')).GET;
	testSpace = (await import('$lib/server/space')).getSpace();
});

afterAll(async () => {
	const sp = (await import('$lib/server/space')).getSpace();
	sp.close();
	rmSync(root, { recursive: true, force: true });
});

const call = (name: string, file: string) =>
	GET({
		params: { name, file },
		locals: { space: testSpace }
	} as unknown as Parameters<typeof GET>[0]);

describe('theme asset route', () => {
	test('serves theme.css with text/css', async () => {
		const res = await call('amber-default', 'theme.css');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('text/css');
		expect(await res.text()).toBe(':root{--x:1}');
	});
	test('serves theme.js with text/javascript so module scripts load', async () => {
		const res = await call('amber-default', 'theme.js');
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
		expect(await res.text()).toBe('console.log(1)');
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
	// `name` is meant to be a single path segment. These can't arrive via
	// SvelteKit's normalized routing, but the explicit guard makes the
	// containment check below unconditionally sound.
	test('404 when the theme name is "." (would resolve to themes/ itself)', async () => {
		const res = await call('.', 'theme.css');
		expect(res.status).toBe(404);
	});
	test('404 when the theme name is ".." (would escape themes/)', async () => {
		const res = await call('..', 'amber.toml');
		expect(res.status).toBe(404);
	});
	test('404 when the theme name contains a slash', async () => {
		const res = await call('amber-default/fonts', 'x.woff2');
		expect(res.status).toBe(404);
	});
});

describe('theme asset route — shared themes', () => {
	let sharedDir: string;
	let prevEnv: string | undefined;

	beforeAll(() => {
		prevEnv = process.env.AMBER_BUNDLED_THEMES_DIR;
		sharedDir = mkdtempSync(join(tmpdir(), 'amber-shared-assets-'));
		mkdirSync(join(sharedDir, 'amber-brand'), { recursive: true });
		writeFileSync(join(sharedDir, 'amber-brand', 'theme.css'), ':root{--brand:1}');
		process.env.AMBER_BUNDLED_THEMES_DIR = sharedDir;
		__resetSharedThemesForTests();
	});

	afterAll(() => {
		if (prevEnv === undefined) delete process.env.AMBER_BUNDLED_THEMES_DIR;
		else process.env.AMBER_BUNDLED_THEMES_DIR = prevEnv;
		__resetSharedThemesForTests();
		rmSync(sharedDir, { recursive: true, force: true });
	});

	test('serves a shared theme css when the space has no per-space copy', async () => {
		// `testSpace` has only `amber-default` on disk, not `amber-brand`,
		// so amber-brand resolves from the shared dir.
		const res = await call('amber-brand', 'theme.css');
		expect(res.status).toBe(200);
		expect(await res.text()).toBe(':root{--brand:1}');
	});

	test('per-space dir wins over shared for the same name', async () => {
		// `amber-default` exists in the per-space `themes/` (outer setup); even if
		// a shared amber-default existed, the per-space copy is served.
		const res = await call('amber-default', 'theme.css');
		expect(res.status).toBe(200);
		expect(await res.text()).toBe(':root{--x:1}');
	});
});
