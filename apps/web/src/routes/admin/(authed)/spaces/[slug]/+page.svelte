<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<header class="amber-page-head">
	<div class="amber-page-head__text">
		<h1>Pages</h1>
		<p class="amber-page-head__lede">
			Everything in this space. Pick one to edit, or add a new one.
		</p>
	</div>
</header>

{#if data.canPickTheme}
	<p class="meta">
		Theme: <strong>{data.activeThemeName}</strong>
		<a
			class="amber-btn amber-btn--ghost amber-btn--sm"
			href={resolve(`/admin/spaces/${data.slug}/theme` as '/admin/spaces/[slug]/theme')}>Change</a
		>
		{#if data.publicUrl}
			<!-- publicUrl is the space's own external site URL, not an internal SvelteKit route. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			<a href={data.publicUrl} target="_blank" rel="noopener">view your site ↗</a>
		{/if}
	</p>
{/if}

<p class="new-page">
	<a
		class="amber-btn amber-btn--primary"
		href={resolve(`/admin/spaces/${data.slug}/new` as '/admin/spaces/[slug]/new')}>+ New page</a
	>
</p>

<ul class="amber-list">
	{#each data.pages as page (page.url)}
		<li class="amber-list__row">
			<a
				class="amber-list__link"
				href={resolve(
					`/admin/spaces/${data.slug}/edit/${page.apiPath}` as '/admin/spaces/[slug]/edit/[...path]'
				)}>{page.title}</a
			>
			<code class="amber-list__meta">{page.url}</code>
			{#if page.draft}<span class="amber-badge">draft</span>{/if}
		</li>
	{/each}
</ul>

<style>
	.meta {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 0.6rem;
		color: var(--amber-ink-muted);
		font-size: 0.9rem;
		margin: 0 0 1rem;
	}
	.meta strong {
		color: var(--amber-ink);
	}
	.meta a:not(.amber-btn) {
		color: var(--amber-accent);
	}
	.meta a:not(.amber-btn):hover {
		color: var(--amber-accent-hover);
	}
	.new-page {
		margin: 0 0 1rem;
	}
</style>
