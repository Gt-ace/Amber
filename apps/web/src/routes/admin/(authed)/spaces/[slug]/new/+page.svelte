<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData, ActionData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>New page — Amber admin</title>
</svelte:head>

<p>
	<a href={resolve(`/admin/spaces/${data.slug}` as '/admin/spaces/[slug]')}>← All pages</a>
</p>
<h1>New page</h1>

{#if form?.error}
	<p class="amber-error" role="alert">{form.error}</p>
{/if}

<form method="POST" class="amber-new-form">
	<label>
		Directory
		<select name="directory">
			{#each data.directories as dir (dir)}
				<option value={dir}>{dir === '' ? '(space root)' : dir}</option>
			{/each}
		</select>
	</label>
	<label>
		Filename
		<input type="text" name="filename" placeholder="my-page" required />
		<small>`.md` is appended if you omit it.</small>
	</label>
	<label>
		Title
		<input type="text" name="title" placeholder="My Page" />
	</label>
	<label class="amber-check">
		<input type="checkbox" name="draft" />
		Draft
	</label>
	<button type="submit">Create page</button>
</form>

<style>
	.amber-new-form label {
		display: block;
		margin-bottom: 1rem;
	}
	.amber-new-form input[type='text'],
	.amber-new-form select {
		display: block;
		margin-top: 0.2rem;
	}
	.amber-check {
		display: flex;
		gap: 0.4rem;
		align-items: center;
	}
	.amber-error {
		color: #a11;
		font-weight: 600;
	}
	small {
		color: #777;
	}
</style>
