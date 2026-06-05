<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	// Crepe's CSS is static (Vite extracts it, no JS executes); the Crepe
	// runtime itself is dynamic-imported in onMount so it never enters SSR.
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/frame.css';

	let { data }: { data: PageData } = $props();

	let editorEl: HTMLDivElement;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let crepe: any = null;

	// `hash` is mutated by save() but never read in the template, so a plain
	// `let` is sufficient and avoids a needless reactive binding.
	// svelte-ignore state_referenced_locally
	let hash = data.hash;
	// These three seed local form state from the server-loaded values and then
	// diverge as the user edits; a one-time snapshot is exactly the intent, so
	// the state_referenced_locally advisory is suppressed deliberately.
	// svelte-ignore state_referenced_locally
	let fmTitle = $state(data.frontmatter.title);
	// svelte-ignore state_referenced_locally
	let fmDate = $state(data.frontmatter.date);
	// svelte-ignore state_referenced_locally
	let fmDraft = $state(data.frontmatter.draft);
	let fmDirty = $state(false);
	let status = $state('');
	let conflict = $state(false);
	let saving = $state(false);

	function markFmDirty() {
		fmDirty = true;
	}

	onMount(async () => {
		// Client-only, dynamic import: Crepe (ProseMirror + Vue) stays out of
		// the SSR bundle and out of the public render path entirely (spec §9).
		const { Crepe, CrepeFeature } = await import('@milkdown/crepe');
		crepe = new Crepe({
			root: editorEl,
			defaultValue: data.body,
			// Surface Crepe's already-enabled features behind a persistent,
			// always-visible toolbar instead of leaving them hidden behind the
			// `/` slash menu and the select-text floating bar. Curated so every
			// control round-trips to markdown the public renderer can actually
			// render: the renderer is plugin-free markdown-it (lib/render/render.ts),
			// so math (`$…$`) and task lists (`- [ ]`) would degrade on the public
			// site. We drop both from the toolbar AND the slash menu so the editor
			// never advertises something the site silently mangles.
			features: {
				[CrepeFeature.TopBar]: true,
				// Latex gates the math button in both the toolbar and the slash
				// menu, so one flag removes it from both surfaces.
				[CrepeFeature.Latex]: false
			},
			featureConfigs: {
				[CrepeFeature.TopBar]: {
					// buildTopBar runs after the default groups are built and
					// receives the live builder; `getGroup('list').group.items` is
					// the same array `build()` returns, so filtering it drops just
					// the task-list button without reconstructing the others.
					buildTopBar: (builder) => {
						const list = builder.getGroup('list').group;
						list.items = list.items.filter((item) => item.key !== 'task-list');
					}
				},
				[CrepeFeature.BlockEdit]: {
					// Mirror the removal in the `/` slash menu. Partial override:
					// bulletList/orderedList are untouched and stay.
					listGroup: { taskList: null }
				}
			}
		});
		await crepe.create();
	});

	onDestroy(() => {
		crepe?.destroy();
	});

	async function save(force = false) {
		if (!crepe || saving) return;
		saving = true;
		status = 'Saving…';
		const payload: { body: string; frontmatter?: typeof data.frontmatter } = {
			body: crepe.getMarkdown()
		};
		// Only send frontmatter when the panel was actually edited (spec §3, §5).
		if (fmDirty && data.fmEditable) {
			payload.frontmatter = { title: fmTitle, draft: fmDraft, date: fmDate };
		}
		try {
			const res = await fetch(`/admin/spaces/${data.slug}/api/page/${data.apiPath}`, {
				method: 'PUT',
				headers: {
					'Content-Type': 'application/json',
					'If-Match': force ? '*' : hash
				},
				body: JSON.stringify(payload)
			});
			if (res.status === 409) {
				conflict = true;
				status = '';
				return;
			}
			if (!res.ok) {
				status = `Save failed (${res.status}).`;
				return;
			}
			const out = (await res.json()) as { hash: string };
			hash = out.hash;
			fmDirty = false;
			conflict = false;
			status = 'Saved.';
		} catch (e) {
			status = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
		} finally {
			saving = false;
		}
	}

	function reloadFromDisk() {
		// Discard in-editor changes; the load gives a fresh body/FM/hash.
		location.reload();
	}
</script>

<svelte:head>
	<title>Editing {data.url} · Amber admin</title>
</svelte:head>

<p class="back">
	<a href={resolve(`/admin/spaces/${data.slug}` as '/admin/spaces/[slug]')}>← All pages</a>
</p>
<header class="amber-page-head">
	<div class="amber-page-head__text">
		<h1>Editing <code>{data.url}</code></h1>
	</div>
</header>

{#if conflict}
	<div class="amber-notice amber-notice--warn" role="alert">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
			<path
				d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
			/>
		</svg>
		<span class="conflict-body">
			<span>This page changed on disk since you opened it.</span>
			<span class="conflict-actions">
				<button
					type="button"
					class="amber-btn amber-btn--ghost amber-btn--sm"
					onclick={reloadFromDisk}>Reload disk version</button
				>
				<button
					type="button"
					class="amber-btn amber-btn--primary amber-btn--sm"
					onclick={() => save(true)}>Overwrite with my changes</button
				>
			</span>
		</span>
	</div>
{/if}

<div class="amber-edit-grid">
	<div class="amber-body" bind:this={editorEl}></div>

	<aside class="amber-panel">
		<h2>Frontmatter</h2>
		{#if data.fmEditable}
			<label class="amber-field">
				<span>Title</span>
				<input class="amber-input" type="text" bind:value={fmTitle} oninput={markFmDirty} />
			</label>
			<label class="amber-field">
				<span>Date</span>
				<input
					class="amber-input"
					type="text"
					placeholder="YYYY-MM-DD"
					bind:value={fmDate}
					oninput={markFmDirty}
				/>
			</label>
			<label class="amber-check">
				<input type="checkbox" bind:checked={fmDraft} onchange={markFmDirty} />
				Draft
			</label>
		{:else}
			<p class="amber-notice amber-notice--warn" role="alert">
				<svg
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<path
						d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
					/>
				</svg>
				<span>
					Frontmatter YAML can't be parsed, so this panel is read-only. Fix it in the file to
					re-enable editing.
				</span>
			</p>
		{/if}
	</aside>
</div>

<p class="amber-actions">
	<button
		type="button"
		class="amber-btn amber-btn--primary"
		onclick={() => save(false)}
		disabled={saving}>Save</button
	>
	<span class="amber-status">{status}</span>
</p>

<style>
	.back {
		margin: 0 0 0.75rem;
	}
	.back a {
		color: var(--amber-ink-muted);
		text-decoration: none;
		font-size: 0.9rem;
	}
	.back a:hover {
		color: var(--amber-ink);
	}
	h1 code {
		font-size: 0.85em;
		background: var(--amber-bg);
		border: 1px solid var(--amber-rule);
		border-radius: 4px;
		padding: 0.05rem 0.3rem;
	}

	/* The conflict notice stacks its actions below the text when they don't
	   fit the notice's flex row. */
	.conflict-body {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}
	.conflict-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.5rem;
	}

	/* The editor needs far more room than the default admin column. Widen the
	   whole edit page (header, notices, grid, save row together) only when the
	   edit grid is present, so every other admin page keeps the narrow column. */
	:global(.amber-admin-main:has(.amber-edit-grid)) {
		max-width: 88rem;
	}

	.amber-edit-grid {
		display: grid;
		grid-template-columns: 1fr 20rem;
		gap: 1.5rem;
		align-items: start;
	}
	.amber-body {
		border: 1px solid var(--amber-rule);
		border-radius: 4px;
		min-height: min(72vh, 44rem);
	}
	.amber-panel .amber-field {
		margin-bottom: 0.75rem;
	}
	.amber-panel .amber-input {
		width: 100%;
		box-sizing: border-box;
	}
	.amber-check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
		font-size: 0.85rem;
		font-weight: 600;
		color: var(--amber-ink);
	}
	.amber-check input[type='checkbox'] {
		accent-color: var(--amber-accent);
	}
	.amber-actions {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	.amber-status {
		color: var(--amber-ink-muted);
		font-size: 0.9rem;
	}

	/*
	 * Keep the global admin heading rule (brand.css `.amber-admin :is(h1,h2,h3)`,
	 * which sets Fraunces + --amber-ink at specificity 0,1,1) from bleeding into
	 * the document the user is editing. Crepe owns the editor's content
	 * typography; without this the bled --amber-ink renders the document's own
	 * headings as light-beige text on the editor surface in dark mode. The 0,2,1
	 * selector below re-asserts Crepe's own heading styling for editor content.
	 */
	:global(.amber-admin .milkdown :is(h1, h2, h3)) {
		font-family: var(--crepe-font-title);
		font-variation-settings: normal;
		letter-spacing: normal;
		color: var(--crepe-color-on-background);
	}

	/*
	 * The Crepe frame theme imported above is light-only (a white editor
	 * surface). Follow the OS the same way the admin tokens do: when the OS
	 * prefers dark, re-declare the frame theme's variables so the editor matches
	 * the dark admin chrome instead of glaring white. Values copied verbatim from
	 * @milkdown/crepe/theme/frame-dark.css (crepe 7.21.1); re-sync on upgrade.
	 */
	@media (prefers-color-scheme: dark) {
		:global(.milkdown) {
			--crepe-color-background: #1a1a1a;
			--crepe-color-on-background: #e6e6e6;
			--crepe-color-surface: #121212;
			--crepe-color-surface-low: #1c1c1c;
			--crepe-color-on-surface: #d1d1d1;
			--crepe-color-on-surface-variant: #a9a9a9;
			--crepe-color-outline: #757575;
			--crepe-color-primary: #b5b5b5;
			--crepe-color-secondary: #4d4d4d;
			--crepe-color-on-secondary: #d6d6d6;
			--crepe-color-inverse: #e5e5e5;
			--crepe-color-on-inverse: #2a2a2a;
			--crepe-color-inline-code: #ff6666;
			--crepe-color-error: #ff6666;
			--crepe-color-hover: #232323;
			--crepe-color-selected: #2f2f2f;
			--crepe-color-inline-area: #2b2b2b;
			--crepe-shadow-1:
				0px 1px 2px 0px rgba(255, 255, 255, 0.3), 0px 1px 3px 1px rgba(255, 255, 255, 0.15);
			--crepe-shadow-2:
				0px 1px 2px 0px rgba(255, 255, 255, 0.3), 0px 2px 6px 2px rgba(255, 255, 255, 0.15);
		}
	}
</style>
