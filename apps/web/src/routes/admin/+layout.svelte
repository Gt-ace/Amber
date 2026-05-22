<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import type { LayoutData } from './$types';
	let { children, data }: { children: Snippet; data: LayoutData } = $props();
</script>

<svelte:head>
	<title>Amber admin</title>
</svelte:head>

<header class="amber-admin-bar">
	<a href={resolve('/admin')}><strong>Amber</strong> admin</a>
	{#if data.authed}
		<nav class="amber-admin-nav">
			{#if data.user?.isInstallAdmin}
				<a href="/admin/users">Users</a>
			{/if}
			<a href={resolve('/admin/account')}>Account</a>
			<form method="post" action="/api/auth/sign-out" class="amber-signout-form">
				<button type="submit" class="amber-signout-button">Sign out</button>
			</form>
		</nav>
	{/if}
</header>
<main class="amber-admin-main">
	{@render children()}
</main>

<style>
	.amber-admin-bar {
		padding: 0.75rem 1rem;
		border-bottom: 1px solid #ddd;
		font-family: system-ui, sans-serif;
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.amber-admin-bar a {
		color: inherit;
		text-decoration: none;
	}
	.amber-admin-nav {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 0.75rem;
		font-size: 0.9rem;
	}
	.amber-signout-form {
		margin: 0;
	}
	.amber-signout-button {
		background: none;
		border: none;
		color: inherit;
		font: inherit;
		text-decoration: underline;
		cursor: pointer;
		padding: 0;
	}
	.amber-admin-main {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1.5rem 1rem;
		font-family: system-ui, sans-serif;
	}
</style>
