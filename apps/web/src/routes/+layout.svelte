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

{@render children()}
