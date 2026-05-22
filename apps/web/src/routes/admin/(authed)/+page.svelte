<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Spaces — Amber admin</title>
</svelte:head>

<h1>Spaces</h1>

{#if data.emptyState === 'no-memberships'}
	<p>You don't have access to any spaces yet. Ask your administrator to invite you.</p>
{:else if data.emptyState === 'no-spaces-loaded'}
	<p>No spaces loaded. Ask your administrator to add one.</p>
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
