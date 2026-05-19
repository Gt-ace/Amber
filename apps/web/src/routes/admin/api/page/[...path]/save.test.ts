import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RequestHandler } from './$types';
import { hashContent, splitRaw, recombine } from '$lib/server/editor';

const FIXTURE = fileURLToPath(new URL('../../../../../../fixtures/example-space/', import.meta.url));

let workDir: string;
let PUT: RequestHandler;

beforeEach(async () => {
	process.env.AMBER_DEV_UNSAFE = '1';
	workDir = mkdtempSync(join(tmpdir(), 'amber-save-'));
	cpSync(FIXTURE, workDir, { recursive: true });
	rmSync(join(workDir, '.amber'), { recursive: true, force: true });
	process.env.AMBER_SPACE_PATH = workDir;
	// Import deferred so AMBER_SPACE_PATH is set before getSpace() runs.
	const mod = await import('./+server.ts');
	PUT = mod.PUT;
});

afterEach(async () => {
	const { getSpace } = await import('$lib/server/space');
	getSpace().close();
	rmSync(workDir, { recursive: true, force: true });
	delete process.env.AMBER_DEV_UNSAFE;
});

/** Build a RequestEvent-shaped stub with a real Request for `[...path]`. */
function event(path: string, init: RequestInit & { ifMatch?: string }) {
	const headers = new Headers(init.headers);
	headers.set('Content-Type', 'application/json');
	if (init.ifMatch !== undefined) headers.set('If-Match', init.ifMatch);
	const request = new Request(`http://x/admin/api/page/${path}`, {
		method: 'PUT',
		headers,
		body: init.body
	});
	return { params: { path }, request } as unknown as Parameters<RequestHandler>[0];
}

describe('PUT /admin/api/page/[...path]', () => {
	test('404 for an unknown page', async () => {
		try {
			await PUT(event('no-such-page', { body: JSON.stringify({ body: 'x' }), ifMatch: '*' }));
			expect.unreachable('should have thrown 404');
		} catch (e) {
			expect((e as { status: number }).status).toBe(404);
		}
	});

	test('400 when body is missing or not a string', async () => {
		for (const bad of [JSON.stringify({}), JSON.stringify({ body: 42 })]) {
			try {
				await PUT(event('about', { body: bad, ifMatch: '*' }));
				expect.unreachable('should have thrown 400');
			} catch (e) {
				expect((e as { status: number }).status).toBe(400);
			}
		}
	});

	test('idempotent round-trip: an unedited body-only save reaches a fixed point', async () => {
		const file = join(workDir, 'about.md');
		const original = readFileSync(file, 'utf8');
		const { fmBlock, body } = splitRaw(original);

		const res1 = await PUT(
			event('about', { body: JSON.stringify({ body }), ifMatch: hashContent(original) })
		);
		expect(res1.status).toBe(200);
		const afterFirst = readFileSync(file, 'utf8');
		expect(afterFirst).toBe(recombine(fmBlock, body));

		const hash1 = (await res1.json()).hash as string;
		const res2 = await PUT(
			event('about', { body: JSON.stringify({ body }), ifMatch: hash1 })
		);
		expect(res2.status).toBe(200);
		expect(readFileSync(file, 'utf8')).toBe(afterFirst);
	});

	test('409 when If-Match is stale, then If-Match:* overwrites', async () => {
		const file = join(workDir, 'about.md');
		const staleHash = hashContent(readFileSync(file, 'utf8'));

		writeFileSync(file, readFileSync(file, 'utf8') + '\nout-of-band\n', 'utf8');

		try {
			await PUT(event('about', { body: JSON.stringify({ body: 'New body\n' }), ifMatch: staleHash }));
			expect.unreachable('a stale If-Match should have thrown 409');
		} catch (e) {
			expect((e as { status: number }).status).toBe(409);
		}

		const forced = await PUT(
			event('about', { body: JSON.stringify({ body: 'New body\n' }), ifMatch: '*' })
		);
		expect(forced.status).toBe(200);
		expect(readFileSync(file, 'utf8')).toContain('New body');
	});

	test('a frontmatter-edited save preserves untouched keys', async () => {
		const file = join(workDir, 'about.md');
		const hash = hashContent(readFileSync(file, 'utf8'));
		const res = await PUT(
			event('about', {
				body: JSON.stringify({ body: 'Body\n', frontmatter: { title: 'Renamed', draft: false } }),
				ifMatch: hash
			})
		);
		expect(res.status).toBe(200);
		const after = readFileSync(file, 'utf8');
		expect(after).toContain('title: Renamed');
		expect(after).toContain('description:');
	});

	test('422 when a frontmatter-carrying save targets a page with unparseable YAML', async () => {
		const file = join(workDir, 'about.md');
		writeFileSync(file, '---\n\ttitle: broken: : :\n---\n\nBody\n', 'utf8');
		const hash = hashContent(readFileSync(file, 'utf8'));
		try {
			await PUT(
				event('about', {
					body: JSON.stringify({ body: 'Body\n', frontmatter: { title: 'X' } }),
					ifMatch: hash
				})
			);
			expect.unreachable('unparseable frontmatter should have thrown 422');
		} catch (e) {
			expect((e as { status: number }).status).toBe(422);
		}
		expect(readFileSync(file, 'utf8')).toContain('broken: : :');
	});
});
