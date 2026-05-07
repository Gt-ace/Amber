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

<header>
	{#if data.site?.title}
		<a href="/" class="site-title">{data.site.title}</a>
	{/if}
	{#if data.nav.length > 0}
		<nav aria-label="Primary">
			<ul>
				{#each data.nav as entry (entry.kind + (entry.kind === 'group' ? entry.label : entry.url))}
					{#if entry.kind === 'page' || entry.kind === 'external'}
						<li><a href={entry.url}>{entry.label}</a></li>
					{:else if entry.kind === 'group'}
						<li>
							<span>{entry.label}</span>
							<ul>
								{#each entry.children as child (child.kind === 'group' ? child.label : child.url)}
									{#if child.kind === 'page' || child.kind === 'external'}
										<li><a href={child.url}>{child.label}</a></li>
									{/if}
								{/each}
							</ul>
						</li>
					{/if}
				{/each}
			</ul>
		</nav>
	{/if}
</header>

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
