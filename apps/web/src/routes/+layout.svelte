<script lang="ts">
	import type { Snippet } from 'svelte';
	import favicon from '$lib/assets/favicon.svg';
	import type { LayoutData } from './$types';

	let { data, children }: { data: LayoutData; children: Snippet } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
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

<!-- eslint-disable svelte/no-at-html-tags -->
{@html data.chromeBefore}
{@render children()}
{@html data.chromeAfter}
