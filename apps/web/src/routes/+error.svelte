<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head>
	<title>{page.status} — {page.error?.message ?? 'Error'}</title>
</svelte:head>

<main>
	{#if page.status === 404}
		{#if page.data.notFoundHtml}
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html page.data.notFoundHtml}
		{:else}
			<h1>Page not found</h1>
			<p>The page you were looking for doesn't exist.</p>
			<p><a href="/">Back to home</a></p>
		{/if}
	{:else}
		<h1>{page.status}</h1>
		<p>{page.error?.message ?? 'Something went wrong.'}</p>
		<p><a href="/">Back to home</a></p>
	{/if}
</main>
