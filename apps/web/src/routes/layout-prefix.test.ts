/**
 * v0.5 subsystem 3 followup #6 — the root layout must emit theme asset URLs
 * under the active mount prefix. A prefix-mounted space ships unstyled
 * otherwise (the browser fetches `/themes/...` with no prefix, the resolver
 * matches no prefix and routes the asset request to the default space).
 *
 * `apps/web/fixtures/example-space/` deliberately has no usable theme (the
 * one `themes/minimal/` dir is missing required templates), so the existing
 * page.test.ts can only assert the null case. This file stands up a tiny
 * scratch space with a complete theme so we can exercise the prefix-injected
 * `themeCssHref` directly.
 */

import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Space } from '$lib/space/space';

const FULL_THEME_FILES = {
	'theme.toml': 'name = "Test"\nversion = "1.0"\n',
	'theme.css': ':root { --x: 1 }',
	'chrome.html': '<header></header><!--amber:content--><footer></footer>',
	'page.html': '<article>{{{html}}}</article>',
	'error.html': '<p>{{status}}</p>'
};

let layoutLoad: typeof import('./+layout.server.ts').load;
let space: Space;
let root: string;

beforeAll(async () => {
	root = mkdtempSync(join(tmpdir(), 'amber-layout-prefix-'));
	// Minimal space with an `amber-default` theme that the resolver chain will pick.
	writeFileSync(join(root, 'amber.toml'), 'amber_version = "0.1"\n');
	writeFileSync(join(root, 'index.md'), '# hi\n');
	const themeDir = join(root, 'themes', 'amber-default');
	mkdirSync(themeDir, { recursive: true });
	for (const [name, content] of Object.entries(FULL_THEME_FILES)) {
		writeFileSync(join(themeDir, name), content);
	}
	const loaded = Space.load(root, { cache: false });
	space = loaded.space;
	layoutLoad = (await import('./+layout.server.ts')).load;
});

afterAll(() => {
	space.close();
	rmSync(root, { recursive: true, force: true });
});

const stub = (mountPrefix: string) =>
	({
		params: {},
		url: new URL('http://localhost/'),
		locals: { space, mountPrefix }
	}) as unknown as Parameters<typeof layoutLoad>[0];

describe('root +layout.server load — mountPrefix and theme assets', () => {
	test('no prefix → themeCssHref is rooted at /themes and carries a cache-busting ?v=', () => {
		const out = layoutLoad(stub('')) as { themeCssHref: string | null };
		expect(out.themeCssHref).toMatch(/^\/themes\/amber-default\/theme\.css\?v=[^&]+$/);
	});

	test('prefix → themeCssHref carries the prefix so the asset request stays in this space', () => {
		const out = layoutLoad(stub('/scratch')) as { themeCssHref: string | null };
		expect(out.themeCssHref).toMatch(/^\/scratch\/themes\/amber-default\/theme\.css\?v=[^&]+$/);
	});
});
