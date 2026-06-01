<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<svelte:head>
	<!-- Favicons + app icons are install-wide; they live in app.html, not here. -->
	{#if data.themeCssHref}
		<link rel="stylesheet" href={data.themeCssHref} />
	{/if}
	{#if data.themeColor?.light}
		<meta
			name="theme-color"
			content={data.themeColor.light}
			media="(prefers-color-scheme: light)"
		/>
	{/if}
	{#if data.themeColor?.dark}
		<meta name="theme-color" content={data.themeColor.dark} media="(prefers-color-scheme: dark)" />
	{/if}
</svelte:head>

<!--
	The active theme's chrome, split at its amber:content marker into the bit
	before the page content and the bit after (see +layout.server.ts). That
	marker sits between balanced top-level elements in chrome.html (after the
	header, before the footer), so each half is a well-formed fragment —
	required for {@html} and for hydration to line up. The page itself
	(+page.svelte or +error.svelte, both routed through children) goes inside
	this main landmark, which Amber owns so a theme can't omit, misplace, or
	duplicate it.
-->
<!-- eslint-disable svelte/no-at-html-tags -->
{#if data.admin}
	{@render children()}
{:else}
	{@html data.chromeBefore}
	<main>
		{@render children()}
	</main>
	{@html data.chromeAfter}
{/if}
