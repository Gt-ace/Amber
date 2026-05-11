<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const ogUrl = $derived(data.siteUrl ? data.siteUrl + data.page.url : data.page.url);
	const ogTitle = $derived(data.page.frontmatter.title ?? data.site?.title ?? '');
</script>

<svelte:head>
	{#if data.page.frontmatter.title}
		<title>{data.page.frontmatter.title}{data.site?.title ? ` — ${data.site.title}` : ''}</title>
	{:else if data.site?.title}
		<title>{data.site.title}</title>
	{/if}
	{#if data.page.frontmatter.description}
		<meta name="description" content={data.page.frontmatter.description} />
	{/if}
	{#if ogTitle}
		<meta property="og:title" content={ogTitle} />
	{/if}
	{#if data.page.frontmatter.description}
		<meta property="og:description" content={data.page.frontmatter.description} />
	{/if}
	<meta property="og:type" content="website" />
	<meta property="og:url" content={ogUrl} />
	<link rel="canonical" href={ogUrl} />
</svelte:head>

<!-- eslint-disable-next-line svelte/no-at-html-tags -->
{@html data.bodyHtml}
