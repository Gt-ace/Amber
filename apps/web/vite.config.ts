import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		expect: { requireAssertions: true },
		globalSetup: ['./vitest.setup.ts'],
		projects: [
			{
				extends: './vite.config.ts',
				test: {
					name: 'server',
					environment: 'node',
					include: ['src/**/*.{test,spec}.{js,ts}'],
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
					include: process.env.AMBER_E2E ? ['src/**/*.e2e.{test,spec}.{js,ts}'] : []
				}
			}
		]
	}
});
