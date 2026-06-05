<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData, ActionData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>New page · Amber admin</title>
</svelte:head>

<p class="back">
	<a href={resolve(`/admin/spaces/${data.slug}` as '/admin/spaces/[slug]')}>← All pages</a>
</p>

<header class="amber-page-head">
	<div class="amber-page-head__text">
		<h1>New page</h1>
		<p class="amber-page-head__lede">Add a markdown page to this space.</p>
	</div>
</header>

{#if form?.error}
	<p class="amber-notice amber-notice--error" role="alert">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
			<path
				d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
			/>
		</svg>
		{form.error}
	</p>
{/if}

<form method="POST" class="amber-form">
	<label class="amber-field">
		<span>Directory</span>
		<select class="amber-input" name="directory">
			{#each data.directories as dir (dir)}
				<option value={dir}>{dir === '' ? '(space root)' : dir}</option>
			{/each}
		</select>
	</label>
	<label class="amber-field">
		<span>
			Filename
			<span class="amber-field__hint">`.md` is appended if you omit it.</span>
		</span>
		<input class="amber-input" type="text" name="filename" placeholder="my-page" required />
	</label>
	<label class="amber-field">
		<span>Title</span>
		<input class="amber-input" type="text" name="title" placeholder="My Page" />
	</label>
	<label class="amber-check">
		<input type="checkbox" name="draft" />
		Draft
	</label>
	<button type="submit" class="amber-btn amber-btn--primary">Create page</button>
</form>

<style>
	.back {
		font-size: 0.9rem;
	}
	.back a {
		color: var(--amber-ink-muted);
	}
	.amber-check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
</style>
