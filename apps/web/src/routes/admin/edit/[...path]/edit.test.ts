import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';

const FIXTURE = fileURLToPath(new URL('../../../../../fixtures/example-space/', import.meta.url));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let load: (event: any) => Promise<Record<string, any>> = null!;

beforeAll(async () => {
	process.env.AMBER_DEV_UNSAFE = '1';
	process.env.AMBER_SPACE_PATH = FIXTURE.replace(/\/$/, '');
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	load = (await import('./+page.server.ts')).load as any;
});

afterAll(async () => {
	(await import('$lib/server/space')).getSpace().close();
	delete process.env.AMBER_DEV_UNSAFE;
});

const stub = (path: string) => ({ params: { path } });

describe('editor +page.server load', () => {
	test('returns body, editable frontmatter and a hash for a real page', async () => {
		const data = await load(stub('about'));
		expect(data.url).toBe('/about');
		expect(data.apiPath).toBe('about');
		expect(data.body).toContain('I trained as a printmaker');
		expect(data.body.startsWith('---')).toBe(false);
		expect(data.frontmatter.title).toBe('About');
		expect(data.fmEditable).toBe(true);
		expect(data.hash).toMatch(/^[0-9a-f]{64}$/);
	});

	test('a draft page is editable (drafts are in the index)', async () => {
		const data = await load(stub('notes/unfinished-essay'));
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
