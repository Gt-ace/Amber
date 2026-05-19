<script lang="ts">
	import type { PageData } from './$types';
	let { data }: { data: PageData } = $props();
</script>

<h1>Pages</h1>
<p><a href="/admin/new">+ New page</a></p>

<ul class="amber-page-list">
	{#each data.pages as page (page.url)}
		<li>
			<a href="/admin/edit/{page.apiPath}">{page.title}</a>
			<code>{page.url}</code>
			{#if page.draft}<span class="amber-draft">draft</span>{/if}
		</li>
	{/each}
</ul>

<style>
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
