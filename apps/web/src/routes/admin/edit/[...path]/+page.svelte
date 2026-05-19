<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import type { PageData } from './$types';
	// Crepe's CSS is static (Vite extracts it — no JS executes); the Crepe
	// runtime itself is dynamic-imported in onMount so it never enters SSR.
	import '@milkdown/crepe/theme/common/style.css';
	import '@milkdown/crepe/theme/frame.css';

	let { data }: { data: PageData } = $props();

	let editorEl: HTMLDivElement;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	let crepe: any = null;

	let hash = $state(data.hash);
	let fmTitle = $state(data.frontmatter.title);
	let fmDate = $state(data.frontmatter.date);
	let fmDraft = $state(data.frontmatter.draft);
	let fmDirty = $state(false);
	let status = $state('');
	let conflict = $state(false);
	let saving = $state(false);

	function markFmDirty() {
		fmDirty = true;
	}

	onMount(async () => {
		// Client-only, dynamic import — Crepe (ProseMirror + Vue) stays out of
		// the SSR bundle and out of the public render path entirely (spec §9).
		const { Crepe } = await import('@milkdown/crepe');
		crepe = new Crepe({ root: editorEl, defaultValue: data.body });
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
			const res = await fetch(`/admin/api/page/${data.apiPath}`, {
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
	<title>Editing {data.url} — Amber admin</title>
</svelte:head>

<p><a href="/admin">← All pages</a></p>
<h1>Editing <code>{data.url}</code></h1>

{#if conflict}
	<div class="amber-conflict" role="alert">
		<p>This page changed on disk since you opened it.</p>
		<button type="button" onclick={reloadFromDisk}>Reload disk version</button>
		<button type="button" onclick={() => save(true)}>Overwrite with my changes</button>
	</div>
{/if}

<div class="amber-edit-grid">
	<div class="amber-body" bind:this={editorEl}></div>

	<aside class="amber-fm">
		<h2>Frontmatter</h2>
		{#if data.fmEditable}
			<label>
				Title
				<input type="text" bind:value={fmTitle} oninput={markFmDirty} />
			</label>
			<label>
				Date
				<input
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
			<p class="amber-fm-disabled">
				This page's frontmatter YAML cannot be parsed, so the panel is
				read-only. Fix the YAML directly in the file to re-enable it. A save
				here leaves the frontmatter block untouched.
			</p>
		{/if}
	</aside>
</div>

<p class="amber-actions">
	<button type="button" onclick={() => save(false)} disabled={saving}>Save</button>
	<span class="amber-status">{status}</span>
</p>

<style>
	.amber-edit-grid {
		display: grid;
		grid-template-columns: 1fr 18rem;
		gap: 1.5rem;
		align-items: start;
	}
	.amber-body {
		border: 1px solid #ddd;
		border-radius: 4px;
		min-height: 24rem;
	}
	.amber-fm label {
		display: block;
		margin-bottom: 0.75rem;
	}
	.amber-fm input[type='text'] {
		display: block;
		width: 100%;
		box-sizing: border-box;
	}
	.amber-check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.amber-fm-disabled {
		color: #885500;
		font-size: 0.9rem;
	}
	.amber-conflict {
		border: 1px solid #cc6600;
		background: #fff6e8;
		padding: 0.75rem 1rem;
		border-radius: 4px;
		margin-bottom: 1rem;
	}
	.amber-actions {
		margin-top: 1rem;
	}
	.amber-status {
		margin-left: 0.75rem;
		color: #555;
	}
</style>
