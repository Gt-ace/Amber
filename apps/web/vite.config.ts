import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

// better-auth's Kysely adapter does a runtime `await import('./bun-sqlite-dialect-...')`
// to keep its dialect tree-shakable. When Vite chunks the SSR bundle, that
// dynamic import resolves to an empty module — the chunk's exports race with
// the dialect chunk's evaluation. Keep better-auth + Kysely external in the
// SSR build so Node/Bun does the dynamic import directly against the
// installed package. Only applied during `vite build`, not during vitest's
// transform pipeline (where externalizing causes "cannot resolve entry").
const isBuild = process.argv[1]?.endsWith('vite') && process.argv.includes('build');

export default defineConfig({
	plugins: [sveltekit()],
	...(isBuild
		? {
				ssr: {
					external: ['better-auth', '@better-auth/kysely-adapter', 'kysely']
				}
			}
		: {}),
	test: {
		expect: { requireAssertions: true },
		globalSetup: ['./vitest.setup.ts'],
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}', 'bin/**/*.{test,spec}.{js,ts}'],
					// `.svelte.test.ts` are component tests (none yet); `.e2e.test.ts`
					// is the opt-in browser smoke (its own project, below).
					exclude: ['src/**/*.svelte.{test,spec}.{js,ts}', 'src/**/*.e2e.{test,spec}.{js,ts}']
				}
			},
			{
				// Opt-in browser smoke. Needs a built bundle, Bun, and a working
				// Chromium (see apps/web/CLAUDE.md → "End-to-end smoke"). Without
				// AMBER_E2E set the project matches no files, so `bun test` stays
				// hermetic.
				extends: './vite.config.ts',
				test: {
					name: 'e2e',
					environment: 'node',
					include: process.env.AMBER_E2E ? ['src/**/*.e2e.{test,spec}.{js,ts}'] : [],
					// Each e2e test rebuilds the production bundle and spawns a
					// server against it. Running them in parallel races on
					// `build/`; serialize so the next test's build doesn't
					// overwrite the still-running server's assets.
					fileParallelism: false
				}
			}
		]
	}
});
