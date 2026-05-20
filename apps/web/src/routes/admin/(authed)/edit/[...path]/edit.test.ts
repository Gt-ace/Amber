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

const stub = (path: string) => ({ params: { path } }) as unknown as Parameters<typeof load>[0];

/**
 * Await the load and narrow away the `void` half of PageServerLoad's declared
 * return type, so success-path tests get a fully-typed `data` object.
 */
async function loadData(path: string) {
	const data = await load(stub(path));
	if (!data) throw new Error('load unexpectedly returned void');
	return data;
}

describe('editor +page.server load', () => {
	test('returns body, editable frontmatter and a hash for a real page', async () => {
		const data = await loadData('about');
		expect(data.url).toBe('/about');
		expect(data.apiPath).toBe('about');
		expect(data.body).toContain('I trained as a printmaker');
		expect(data.body.startsWith('---')).toBe(false);
		expect(data.frontmatter.title).toBe('About');
		expect(data.fmEditable).toBe(true);
		expect(data.hash).toMatch(/^[0-9a-f]{64}$/);
	});

	test('a draft page is editable (drafts are in the index)', async () => {
		const data = await loadData('notes/unfinished-essay');
		expect(data.frontmatter.draft).toBe(true);
	});

	test('404 for a URL that resolves to no page', async () => {
		try {
			await load(stub('definitely-not-real'));
			expect.unreachable('should have thrown 404');
		} catch (e) {
			expect((e as { status: number }).status).toBe(404);
		}
	});
});
