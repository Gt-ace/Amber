<script lang="ts">
	import type { Snippet } from 'svelte';
	let { children }: { children: Snippet } = $props();
</script>

<svelte:head>
	<title>Amber admin</title>
</svelte:head>

<header class="amber-admin-bar">
	<a href="/admin"><strong>Amber</strong> admin</a>
</header>
<main class="amber-admin-main">
	{@render children()}
</main>

<style>
	.amber-admin-bar {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #ddd;
		font-family: system-ui, sans-serif;
	}
	.amber-admin-bar a {
		color: inherit;
		text-decoration: none;
	}
	.amber-admin-main {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		font-family: system-ui, sans-serif;
	}
</style>
