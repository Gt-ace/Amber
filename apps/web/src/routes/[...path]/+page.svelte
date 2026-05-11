<!--
	SPIKE — Amber theme exploration (v0.2 pre-Wave-2).
	The <article> structure below is hardcoded for the spike. In Wave 2 it
	becomes a theme template (the theme decides whether/how to show title +
	date + body). See SPIKE_NOTES.md at the repo root.
-->
<script lang="ts">
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Resolve absolute or relative URL for canonical / og:url. When
	// `PUBLIC_SITE_URL` is set, prefix it; otherwise fall back to the
	// page path alone — better than emitting an obviously-wrong placeholder.
	const ogUrl = $derived(data.siteUrl ? data.siteUrl + data.page.url : data.page.url);
	const ogTitle = $derived(data.page.frontmatter.title ?? data.site?.title ?? '');

	// `date` arrives as an ISO 8601 string (the loader normalizes YAML-native
	// dates to ISO too). Format for display in UTC so a bare `date: 2026-04-22`
	// — which the loader stores as midnight UTC — doesn't slip a day in the
	// reader's timezone. Locale is pinned so SSR and hydration agree.
	const displayDate = $derived.by(() => {
		const raw = data.page.frontmatter.date;
		if (!raw) return null;
		const parsed = new Date(raw);
		if (Number.isNaN(parsed.getTime())) return null;
		return parsed.toLocaleDateString('en-US', {
			timeZone: 'UTC',
			year: 'numeric',
			month: 'long',
			day: 'numeric'
		});
	});
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

<main>
	{#if data.page.isDraft}
		<p class="draft-banner" role="status">
			Draft — visible in development only. This page returns 404 in production.
		</p>
	{/if}
	<article>
		{#if data.page.frontmatter.title || displayDate}
			<header class="article-header">
				{#if data.page.frontmatter.title}
					<h1 class="article-title">{data.page.frontmatter.title}</h1>
				{/if}
				{#if displayDate}
					<p class="article-date">
						<time datetime={data.page.frontmatter.date}>{displayDate}</time>
					</p>
				{/if}
			</header>
		{/if}
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		<div class="article-body">{@html data.page.html}</div>
	</article>
</main>
