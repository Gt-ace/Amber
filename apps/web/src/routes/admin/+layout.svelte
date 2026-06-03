<script lang="ts">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import Wordmark from '$lib/brand/Wordmark.svelte';
	import type { LayoutData } from './$types';
	// Brand layer: self-hosted Fraunces + Hanken Grotesk and the warm-amber
	// neutrals, scoped to the admin/authoring surface. Imported here and nowhere
	// else so the public render path stays on system stacks (see brand.css).
	import '$lib/brand/brand.css';
	// Shared admin UI primitives (panels, buttons, fields, badges, notices).
	// Loaded after brand.css so it inherits the warm-amber tokens. Admin-only,
	// same as the brand layer.
	import '$lib/brand/admin.css';
	let { children, data }: { children: Snippet; data: LayoutData } = $props();
</script>

<svelte:head>
	<title>Amber admin</title>
</svelte:head>

<div class="amber-admin">
	<header class="amber-admin-bar">
		<a class="amber-admin-brand" href={resolve('/admin')} aria-label="Amber admin home">
			<Wordmark size="1.4rem" tagline="admin" />
		</a>
		{#if data.authed}
			<nav class="amber-admin-nav">
				{#if data.user?.isInstallAdmin}
					<a href={resolve('/admin/users')}>Users</a>
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
</div>

<style>
	.amber-admin {
		min-height: 100vh;
		background: var(--amber-bg);
		color: var(--amber-ink);
		font-family: var(--amber-font-body);
		/* Hanken at 400 reads a touch light at UI sizes; nudge crispness. */
		-webkit-font-smoothing: antialiased;
	}
	.amber-admin-bar {
		padding: 0.75rem 1.25rem;
		border-bottom: 1px solid var(--amber-rule);
		display: flex;
		align-items: center;
		gap: 1rem;
	}
	.amber-admin-brand {
		display: inline-flex;
		text-decoration: none;
		border-radius: 4px;
	}
	.amber-admin-brand:focus-visible {
		outline: 2px solid var(--amber-accent);
		outline-offset: 3px;
	}
	.amber-admin-nav {
		margin-left: auto;
		display: flex;
		align-items: center;
		gap: 1.1rem;
		font-size: 0.9rem;
	}
	.amber-admin-nav a {
		color: var(--amber-accent);
		text-decoration: none;
	}
	.amber-admin-nav a:hover {
		color: var(--amber-accent-hover);
		text-decoration: underline;
	}
	.amber-signout-form {
		margin: 0;
	}
	.amber-signout-button {
		background: none;
		border: none;
		color: var(--amber-ink-muted);
		font: inherit;
		text-decoration: underline;
		text-underline-offset: 2px;
		cursor: pointer;
		padding: 0;
	}
	.amber-signout-button:hover {
		color: var(--amber-ink);
	}
	.amber-admin-main {
		max-width: 60rem;
		margin: 0 auto;
		padding: 1.5rem 1.25rem;
	}
</style>
