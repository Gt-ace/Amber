<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
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
</svelte:head>

<main>
	{#if data.page.isDraft}
		<p class="draft-banner" role="status">
			Draft — visible in development only. This page returns 404 in production.
		</p>
	{/if}
	{#if data.page.frontmatter.title}
		<h1>{data.page.frontmatter.title}</h1>
	{/if}
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html data.page.html}
</main>
