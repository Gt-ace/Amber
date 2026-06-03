<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Sign in · Amber</title>
</svelte:head>

<h1>Sign in</h1>

<form method="post" use:enhance class="amber-auth-form">
	<input type="hidden" name="next" value={data.next ?? ''} />
	<label>
		Email
		<input type="email" name="email" autocomplete="username" required value={form?.email ?? ''} />
	</label>
	<label>
		Password
		<input type="password" name="password" autocomplete="current-password" required />
	</label>
	{#if form?.error}
		<p class="amber-form-error" role="alert">{form.error}</p>
	{/if}
	<button type="submit">Sign in</button>
</form>

{#if data.googleEnabled}
	<p class="amber-or">or</p>
	<!-- /api/auth/* is handled by better-auth's svelteKitHandler, not a SvelteKit route. -->
	<!-- eslint-disable svelte/no-navigation-without-resolve -->
	<a
		class="amber-oauth-button"
		href={`/api/auth/sign-in/social/google?callbackURL=${encodeURIComponent(data.next ?? '/admin')}`}
		>Continue with Google</a
	>
	<!-- eslint-enable svelte/no-navigation-without-resolve -->
{/if}

<style>
	.amber-auth-form {
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		max-width: 24rem;
	}
	.amber-auth-form label {
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
		font-size: 0.9rem;
	}
	.amber-auth-form input {
		padding: 0.5rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		font: inherit;
	}
	.amber-auth-form button {
		padding: 0.55rem 0.9rem;
		font: inherit;
		cursor: pointer;
	}
	.amber-form-error {
		color: #a40000;
		margin: 0;
	}
	.amber-or {
		max-width: 24rem;
		text-align: center;
		color: #777;
		margin: 1rem 0 0.5rem;
	}
	.amber-oauth-button {
		display: inline-block;
		padding: 0.5rem 0.9rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		text-decoration: none;
		color: inherit;
	}
</style>
