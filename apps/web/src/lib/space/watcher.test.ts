import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Space } from './space.ts';
import { SpaceWatcher } from './watcher.ts';

const FIXTURE = fileURLToPath(new URL('../../../fixtures/example-space/', import.meta.url));

function copyFixture(): string {
	const dir = mkdtempSync(join(tmpdir(), 'amber-watcher-'));
	const src = FIXTURE.replace(/\/$/, '');
	execSync(`umask 022 && cp -r "${src}/." "${dir}/"`, { shell: '/bin/sh' });
	return dir;
}

function delay(ms: number): Promise<void> {
	return new Promise((r) => setTimeout(r, ms));
}

/**
 * Wait for the watcher to emit at least `n` events, capped at `timeoutMs`.
 * Returns the captured events.
 */
async function captureEvents(
	collected: Array<{ event: unknown }>,
	expected: number,
	timeoutMs: number
): Promise<void> {
	const start = Date.now();
	while (collected.length < expected && Date.now() - start < timeoutMs) {
		await delay(20);
	}
}

describe('SpaceWatcher', () => {
	let dir: string;
	let space: Space;
	let watcher: SpaceWatcher;
	const events: Array<{ event: unknown }> = [];

	beforeEach(async () => {
		events.length = 0;
		dir = copyFixture();
		({ space } = Space.load(dir));
		watcher = new SpaceWatcher(space, {
			debounceMs: 50,
			onEvent: (event) => {
				events.push({ event });
			}
		});
		await watcher.ready();
	});

	afterEach(async () => {
		await watcher.close();
		space.close();
		rmSync(dir, { recursive: true, force: true });
	});

	test('add: creating a markdown file fires a single add event and indexes the page', async () => {
		writeFileSync(join(dir, 'colophon.md'), '---\ntitle: C\n---\n\nbody.');
		await captureEvents(events, 1, 2000);

		expect(events.length).toBe(1);
		expect(events[0].event).toMatchObject({ type: 'add', path: 'colophon.md' });
		expect(space.pages.has('/colophon')).toBe(true);
	});

	test('change: editing a tracked file fires a single change event', async () => {
		writeFileSync(join(dir, 'about.md'), '---\ntitle: Edited\n---\n\nbody.');
		await captureEvents(events, 1, 2000);

		expect(events.length).toBe(1);
		expect(events[0].event).toMatchObject({ type: 'change', path: 'about.md' });
		expect(space.pages.get('/about')!.frontmatter.title).toBe('Edited');
	});

	test('unlink: deleting a tracked file fires a single unlink event', async () => {
		unlinkSync(join(dir, 'about.md'));
		await captureEvents(events, 1, 2000);

		expect(events.length).toBe(1);
		expect(events[0].event).toMatchObject({ type: 'unlink', path: 'about.md' });
		expect(space.pages.has('/about')).toBe(false);
	});

	test('manifest_change: editing amber.toml fires a manifest_change event', async () => {
		const original = execSync(`cat "${dir}/amber.toml"`, { encoding: 'utf8' });
		writeFileSync(join(dir, 'amber.toml'), original.replace('"Mira Halden"', '"Renamed"'));
		await captureEvents(events, 1, 2000);

		expect(events.length).toBe(1);
		expect(events[0].event).toMatchObject({ type: 'manifest_change' });
		expect(space.manifest.site?.title).toBe('Renamed');
	});

	test('reserved paths are not watched: writes inside .amber/ produce no events', async () => {
		// `.amber/cache.db` already exists from Space.load. Writing more
		// data into the .amber dir must not trigger the watcher; otherwise
		// our own cache writes would feed back into apply().
		writeFileSync(join(dir, '.amber', 'scratch.txt'), 'noise');
		writeFileSync(join(dir, '_drafts', 'whatever.md'), '---\ntitle: x\n---\n');
		await delay(300);

		expect(events.length).toBe(0);
	});

	test('non-markdown files in content are ignored', async () => {
		writeFileSync(join(dir, 'projects', 'extra.png'), 'not really a png');
		await delay(300);
		expect(events.length).toBe(0);
	});

	test('debounce: many rapid writes collapse into a single change event', async () => {
		for (let i = 0; i < 10; i++) {
			writeFileSync(join(dir, 'about.md'), `---\ntitle: Iteration ${i}\n---\n\nbody.`);
			// Tight loop, well within the debounce window.
		}
		await captureEvents(events, 1, 2000);
		// Wait a bit longer to make sure no late events follow.
		await delay(150);

		expect(events.length).toBe(1);
		expect(events[0].event).toMatchObject({ type: 'change', path: 'about.md' });
		expect(space.pages.get('/about')!.frontmatter.title).toBe('Iteration 9');
	});

	function completeMinimalTheme(): void {
		const t = join(dir, 'themes', 'minimal');
		writeFileSync(join(t, 'theme.css'), ':root{}');
		writeFileSync(join(t, 'chrome.html'), '<!--amber:content-->');
		writeFileSync(join(t, 'page.html'), '{{{html}}}');
		writeFileSync(join(t, 'error.html'), '<p>{{status}}</p>');
	}

	test('space.toml: creating it fires space_config_change and updates the theme', async () => {
		completeMinimalTheme();
		// Theme discovery is cold-start only, so re-load the space to pick up
		// the now-complete `minimal` theme directory before the test mutates
		// space.toml.
		await watcher.close();
		space.close();
		({ space } = Space.load(dir));
		watcher = new SpaceWatcher(space, {
			debounceMs: 50,
			onEvent: (event) => events.push({ event })
		});
		await watcher.ready();
		events.length = 0;

		writeFileSync(join(dir, 'space.toml'), 'theme = "minimal"\n');
		await captureEvents(events, 1, 2000);

		expect(events.length).toBe(1);
		expect(events[0].event).toMatchObject({ type: 'space_config_change' });
		expect(space.theme.name).toBe('minimal');
	});

	test('space.toml: editing it fires a single space_config_change', async () => {
		writeFileSync(join(dir, 'space.toml'), 'theme = "minimal"\n');
		await captureEvents(events, 1, 2000);
		events.length = 0;

		writeFileSync(join(dir, 'space.toml'), '# noop\n');
		await captureEvents(events, 1, 2000);
		expect(events.length).toBe(1);
		expect(events[0].event).toMatchObject({ type: 'space_config_change' });
	});

	test('space.toml: deleting it fires space_config_change', async () => {
		writeFileSync(join(dir, 'space.toml'), 'theme = "minimal"\n');
		await captureEvents(events, 1, 2000);
		events.length = 0;

		unlinkSync(join(dir, 'space.toml'));
		await captureEvents(events, 1, 2000);
		expect(events.length).toBe(1);
		expect(events[0].event).toMatchObject({ type: 'space_config_change' });
	});
});
