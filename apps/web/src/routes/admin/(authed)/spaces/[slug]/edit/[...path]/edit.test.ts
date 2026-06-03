import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest';
import { fileURLToPath } from 'node:url';

// The load now imports the permissions/auth chain (requireSpaceAccess), whose
// first cold transform can exceed vitest's default 10s hook timeout on a cold
// WSL2 box — same headroom the sibling theme/layout-access tests take.
vi.setConfig({ testTimeout: 20000, hookTimeout: 20000 });

const FIXTURE = fileURLToPath(
	new URL('../../../../../../../../fixtures/example-space/', import.meta.url)
);

let load: typeof import('./+page.server.ts').load;

beforeAll(async () => {
	process.env.AMBER_SPACE_PATH = FIXTURE.replace(/\/$/, '');
	process.env.AMBER_AUTH_SECRET = 'x'.repeat(32);
	load = (await import('./+page.server.ts')).load;
});

afterAll(async () => {
	(await import('$lib/server/space')).getSpace().close();
});

async function stub(path: string) {
	const { getSpace } = await import('$lib/server/space');
	const space = getSpace();
	return {
		// The load now self-resolves the Space from the registry and self-guards
		// via requireSpaceAccess (the [slug] layout's `load` is skipped on
		// client-side nav). An install-admin short-circuits the guard with no
		// auth.db, so a stub user is all the role plumbing needs here.
		params: { path, slug: 'example-space' },
		locals: {
			user: { id: 'admin', isInstallAdmin: true, email: 'a@x', name: null },
			access: null,
			role: null,
			space,
			mountPath: null
		}
	} as unknown as Parameters<typeof load>[0];
}

/**
 * Await the load and narrow away the `void` half of PageServerLoad's declared
 * return type, so success-path tests get a fully-typed `data` object.
 */
async function loadData(path: string) {
	const data = await load(await stub(path));
	if (!data) throw new Error('load unexpectedly returned void');
	return data;
}

describe('per-space editor +page.server load', () => {
	test('returns body, editable frontmatter and a hash for a real page', async () => {
		const data = await loadData('about');
		expect(data.url).toBe('/about');
		expect(data.apiPath).toBe('about');
		expect(data.slug).toBe('example-space');
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
			await load(await stub('definitely-not-real'));
			expect.unreachable('should have thrown 404');
		} catch (e) {
			expect((e as { status: number }).status).toBe(404);
		}
	});
});
