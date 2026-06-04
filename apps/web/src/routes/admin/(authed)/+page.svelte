<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Spaces — Amber admin</title>
</svelte:head>

<header class="amber-page-head">
	<div class="amber-page-head__text">
		<h1>Spaces</h1>
		<p class="amber-page-head__lede">Every space you can reach on this install.</p>
	</div>
	{#if data.canCreate}
		<a class="amber-btn amber-btn--primary" href={resolve('/admin/new-space')}>New space</a>
	{/if}
</header>

{#if data.emptyState === 'no-memberships'}
	<p class="empty">
		You don't have access to any spaces yet. Ask your administrator to invite you.
	</p>
{:else if data.emptyState === 'no-spaces-loaded'}
	{#if data.canCreate}
		<p class="empty">
			No spaces yet. <a href={resolve('/admin/new-space')}>Create the first one</a>.
		</p>
	{:else}
		<p class="empty">No spaces loaded. Ask your administrator to add one.</p>
	{/if}
{:else}
	<ul class="amber-list">
		{#each data.spaces as s (s.slug)}
			<li class="amber-list__row">
				<a
					class="amber-list__link"
					href={resolve(`/admin/spaces/${s.slug}` as '/admin/spaces/[slug]')}>{s.title}</a
				>
				<code class="amber-list__meta">/{s.slug}</code>
			</li>
		{/each}
	</ul>
{/if}

<style>
	.empty {
		color: var(--amber-ink-muted);
	}
</style>
