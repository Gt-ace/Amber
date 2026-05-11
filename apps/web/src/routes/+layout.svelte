<!--
	SPIKE — Amber theme exploration (v0.2 pre-Wave-2).
	The page chrome below (header + nav + footer) is hardcoded for the spike.
	In Wave 2 this becomes a theme template; the footer link in particular is a
	stand-in for whatever "theme footer slot / site metadata" ends up being.
	See SPIKE_NOTES.md at the repo root.
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import '../app.css';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
	<meta name="theme-color" content="#faf7f0" media="(prefers-color-scheme: light)" />
	<meta name="theme-color" content="#1a1714" media="(prefers-color-scheme: dark)" />
</svelte:head>

<header class="site-header">
	{#if data.site?.title}
		<a href="/" class="site-title">{data.site.title}</a>
	{/if}
	{#if data.nav.length > 0}
		<nav class="site-nav" aria-label="Primary">
			<ul>
				{#each data.nav as entry (entry.href + entry.label)}
					<li><a href={entry.href}>{entry.label}</a></li>
				{/each}
			</ul>
		</nav>
	{/if}
</header>

{@render children()}

<footer class="site-footer">
	<span>{data.site?.title ?? 'Amber'}</span>
	<a href="https://github.com/Gt-ace/Amber">Source</a>
</footer>
