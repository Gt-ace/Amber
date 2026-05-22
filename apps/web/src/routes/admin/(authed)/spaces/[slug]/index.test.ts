import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(
	new URL('../../../../../../fixtures/example-space/', import.meta.url)
);

let load: typeof import('./+page.server.ts').load;

beforeAll(async () => {
	process.env.AMBER_SPACE_PATH = FIXTURE.replace(/\/$/, '');
	load = (await import('./+page.server.ts')).load;
});

afterAll(async () => {
	(await import('$lib/server/space')).getSpace().close();
});

/**
 * Await the load and narrow away the `void` half of PageServerLoad's declared
 * return type, so the tests get a fully-typed `data` object.
 */
async function loadData() {
	const { getSpace } = await import('$lib/server/space');
	const space = getSpace();
	const event = {
		locals: { space },
		params: { slug: 'example-space' }
	} as unknown as Parameters<typeof load>[0];
	const data = await load(event);
	if (!data) throw new Error('load unexpectedly returned void');
	return data;
}

describe('per-space admin index +page.server load', () => {
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

	test('passes slug through from params', async () => {
		const data = await loadData();
		expect(data.slug).toBe('example-space');
	});
});
