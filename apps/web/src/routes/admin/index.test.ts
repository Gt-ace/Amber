import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

interface PageEntry {
	url: string;
	title: string;
	draft: boolean;
	apiPath: string;
}

interface LoadData {
	pages: PageEntry[];
}

// Typed as the concrete function signature to preserve the return shape.
// PageServerLoad's MaybeWithVoid wrapper erases concrete return types at the
// type level, so we use a compatible narrower signature here instead.
let load: (_event: object) => LoadData | Promise<LoadData>;

beforeAll(async () => {
	process.env.AMBER_DEV_UNSAFE = '1';
	process.env.AMBER_SPACE_PATH = FIXTURE.replace(/\/$/, '');
	const mod = await import('./+page.server.ts');
	load = mod.load as typeof load;
});

afterAll(async () => {
	(await import('$lib/server/space')).getSpace().close();
	delete process.env.AMBER_DEV_UNSAFE;
});

/**
 * Await the load and return a fully-typed data object.
 */
async function loadData(): Promise<LoadData> {
	return load({});
}

describe('admin index +page.server load', () => {
	test('lists every page sorted by URL, drafts marked', async () => {
		const data = await loadData();
		const urls = data.pages.map((p) => p.url);
		expect(urls).toEqual([...urls].sort());
		expect(urls).toContain('/');
		expect(urls).toContain('/about');

		const draft = data.pages.find((p) => p.url === '/notes/unfinished-essay');
		expect(draft?.draft).toBe(true);
		const live = data.pages.find((p) => p.url === '/about');
		expect(live?.draft).toBe(false);
	});

	test('apiPath has no leading slash and is empty for the root', async () => {
		const data = await loadData();
		expect(data.pages.find((p) => p.url === '/')?.apiPath).toBe('');
		expect(data.pages.find((p) => p.url === '/about')?.apiPath).toBe('about');
	});
});
