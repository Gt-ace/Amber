<script lang="ts">
	import type { Snippet } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<header>
	{#if data.site?.title}
		<a href="/" class="site-title">{data.site.title}</a>
	{/if}
	{#if data.nav.length > 0}
		<nav aria-label="Primary">
			<ul>
				{#each data.nav as entry (entry.href + entry.label)}
					<li><a href={entry.href}>{entry.label}</a></li>
				{/each}
			</ul>
		</nav>
	{/if}
</header>

{@render children()}
