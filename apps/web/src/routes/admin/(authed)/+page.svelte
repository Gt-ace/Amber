<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Spaces — Amber admin</title>
</svelte:head>

<header class="head">
	<h1>Spaces</h1>
	{#if data.canCreate}
		<a class="new-btn" href={resolve('/admin/new-space')}>New space</a>
	{/if}
</header>

{#if data.emptyState === 'no-memberships'}
	<p>You don't have access to any spaces yet. Ask your administrator to invite you.</p>
{:else if data.emptyState === 'no-spaces-loaded'}
	{#if data.canCreate}
		<p>No spaces yet. <a href={resolve('/admin/new-space')}>Create the first one</a>.</p>
	{:else}
		<p>No spaces loaded. Ask your administrator to add one.</p>
	{/if}
{:else}
	<ul class="amber-space-list">
		{#each data.spaces as s (s.slug)}
			<li>
				<a href={resolve(`/admin/spaces/${s.slug}` as '/admin/spaces/[slug]')}>{s.title}</a>
				<code>/{s.slug}</code>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.head {
		display: flex;
		justify-content: space-between;
		align-items: baseline;
		gap: 1rem;
		margin-bottom: 0.5rem;
	}
	.new-btn {
		font: inherit;
		font-weight: 500;
		padding: 0.4rem 0.8rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #333;
		color: #fff;
		text-decoration: none;
		min-height: 2rem;
		transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	.new-btn:active {
		transform: scale(0.97);
	}
	.amber-space-list {
		list-style: none;
		padding: 0;
	}
	.amber-space-list li {
		padding: 0.4rem 0;
		border-bottom: 1px solid #eee;
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
	}
	.amber-space-list code {
		color: #777;
		font-size: 0.85rem;
	}
</style>
