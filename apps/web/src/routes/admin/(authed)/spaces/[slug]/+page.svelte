<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<h1>Pages</h1>
{#if data.canPickTheme}
	<p class="amber-space-meta">
		Theme: <strong>{data.activeThemeName}</strong>
		<a href={resolve(`/admin/spaces/${data.slug}/theme` as '/admin/spaces/[slug]/theme')}>Change</a>
		{#if data.publicUrl}
			<!-- publicUrl is the space's own external site URL, not an internal SvelteKit route. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			· <a href={data.publicUrl} target="_blank" rel="noopener">view your site ↗</a>
		{/if}
	</p>
{/if}
<p>
	<a href={resolve(`/admin/spaces/${data.slug}/new` as '/admin/spaces/[slug]/new')}>+ New page</a>
</p>

<ul class="amber-page-list">
	{#each data.pages as page (page.url)}
		<li>
			<a
				href={resolve(
					`/admin/spaces/${data.slug}/edit/${page.apiPath}` as '/admin/spaces/[slug]/edit/[...path]'
				)}>{page.title}</a
			>
			<code>{page.url}</code>
			{#if page.draft}<span class="amber-draft">draft</span>{/if}
		</li>
	{/each}
</ul>

<style>
	.amber-space-meta {
		color: #555;
		font-size: 0.9rem;
		margin: 0.25rem 0 0.75rem;
	}
	.amber-page-list {
		list-style: none;
		padding: 0;
	}
	.amber-page-list li {
		padding: 0.4rem 0;
		border-bottom: 1px solid #eee;
		display: flex;
		gap: 0.6rem;
		align-items: baseline;
	}
	.amber-page-list code {
		color: #777;
		font-size: 0.85rem;
	}
	.amber-draft {
		font-size: 0.75rem;
		background: #ffe6b3;
		color: #663c00;
		padding: 0.05rem 0.4rem;
		border-radius: 3px;
	}
</style>
