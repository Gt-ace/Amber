import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

let load: typeof import('./+page.server.ts').load;

beforeAll(async () => {
	process.env.AMBER_DEV_UNSAFE = '1';
	process.env.AMBER_SPACE_PATH = FIXTURE.replace(/\/$/, '');
	load = (await import('./+page.server.ts')).load;
});

afterAll(async () => {
	(await import('$lib/server/space')).getSpace().close();
	delete process.env.AMBER_DEV_UNSAFE;
});

/**
 * Await the load and narrow away the `void` half of PageServerLoad's declared
 * return type, so the tests get a fully-typed `data` object.
 */
async function loadData() {
	const data = await load({} as unknown as Parameters<typeof load>[0]);
	if (!data) throw new Error('load unexpectedly returned void');
	return data;
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
