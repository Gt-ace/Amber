<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Claim this Amber · setup</title>
</svelte:head>

<header class="amber-page-head">
	<div class="amber-page-head__text">
		<h1>Welcome to Amber</h1>
		<p class="amber-page-head__lede">
			No admin account exists yet. Claim this Amber to begin. Once an admin is claimed, this page
			disappears.
		</p>
	</div>
</header>

<form method="post" use:enhance class="amber-form">
	<label class="amber-field">
		<span>Display name</span>
		<input
			class="amber-input"
			type="text"
			name="name"
			autocomplete="name"
			value={form?.name ?? ''}
		/>
	</label>
	<label class="amber-field">
		<span>Email</span>
		<input
			class="amber-input"
			type="email"
			name="email"
			autocomplete="email"
			required
			value={form?.email ?? ''}
		/>
	</label>
	<label class="amber-field">
		<span>
			Password
			<span class="amber-field__hint">At least 8 characters.</span>
		</span>
		<input
			class="amber-input"
			type="password"
			name="password"
			autocomplete="new-password"
			minlength="8"
			required
		/>
	</label>
	{#if form?.error}
		<p class="amber-notice amber-notice--error" role="alert">
			<svg
				viewBox="0 0 24 24"
				fill="none"
				stroke="currentColor"
				stroke-width="2"
				aria-hidden="true"
			>
				<path
					d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
				/>
			</svg>
			{form.error}
		</p>
	{/if}
	<button type="submit" class="amber-btn amber-btn--primary">Claim this Amber</button>
</form>

{#if data.googleEnabled}
	<p class="amber-or">or</p>
	<!-- /api/auth/* is handled by better-auth's svelteKitHandler, not a SvelteKit route. -->
	<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
	<a class="amber-btn amber-btn--ghost" href="/api/auth/sign-in/social/google?callbackURL=/admin"
		>Continue with Google</a
	>
{/if}
