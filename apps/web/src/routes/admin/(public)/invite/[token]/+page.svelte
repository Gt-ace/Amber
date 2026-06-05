<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const state = $derived(data.state);
</script>

{#snippet alertIcon()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
		<path
			d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
		/>
	</svg>
{/snippet}

{#snippet okIcon()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
		<path d="M20 6 9 17l-5-5" />
	</svg>
{/snippet}

<div class="invite">
	<header class="amber-page-head">
		<div class="amber-page-head__text">
			<h1>You've been invited</h1>
			<p class="amber-page-head__lede">Accept this invite to gain access to the space.</p>
		</div>
	</header>

	{#if state.kind === 'signed-out'}
		<p>
			You've been invited as <strong>{state.invite.role}</strong> on
			<strong>{state.invite.spaceTitle ?? state.invite.slug}</strong>.
		</p>
		<form method="POST" action="?/redeemAsNew" use:enhance class="amber-form">
			<label class="amber-field">
				<span>Email</span>
				<input class="amber-input" name="email" type="email" required />
			</label>
			<label class="amber-field">
				<span>
					Password
					<span class="amber-field__hint">At least 8 characters.</span>
				</span>
				<input class="amber-input" name="password" type="password" minlength="8" required />
			</label>
			<label class="amber-field">
				<span>Name</span>
				<input class="amber-input" name="name" type="text" />
			</label>
			{#if form?.redeem?.ok === false}
				<p class="amber-notice amber-notice--error" role="alert">
					{@render alertIcon()}
					{form.redeem.error}
				</p>
			{/if}
			<button type="submit" class="amber-btn amber-btn--primary">Create account and accept</button>
		</form>
		{#if data.googleEnabled}
			<p class="amber-or">or</p>
			<!-- /api/auth/* is handled by better-auth's svelteKitHandler, not a SvelteKit route. -->
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			<a
				class="amber-btn amber-btn--ghost"
				href="/api/auth/sign-in/social/google?callbackURL={encodeURIComponent(
					'/admin/invite/' + page.params.token + '?gstate=' + data.inviteSignedState
				)}"
			>
				Continue with Google
			</a>
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		{/if}
		<p class="alt">
			Already have an account?
			<a
				href="{resolve('/admin/login')}?next={encodeURIComponent(
					'/admin/invite/' + page.params.token
				)}">Sign in to claim.</a
			>
		</p>
	{:else if state.kind === 'install-admin'}
		<section class="amber-panel">
			<p>
				You're the install-admin, so you already have access to every space, including
				<strong>{state.invite.spaceTitle ?? state.invite.slug}</strong>. This invite is intact.
			</p>
			<form method="POST" action="?/revokeIfAdmin" use:enhance>
				<button type="submit" class="amber-btn amber-btn--danger">Revoke this invite</button>
			</form>
		</section>
	{:else if state.kind === 'already-member'}
		<section class="amber-panel">
			<p>
				You already have <strong>{state.currentRole}</strong> access to
				<strong>{state.invite.spaceTitle ?? state.invite.slug}</strong>. This invite is still
				pending and can be passed on or revoked.
			</p>
			{#if state.currentRole === 'owner'}
				<form method="POST" action="?/revokeIfOwner" use:enhance>
					<button type="submit" class="amber-btn amber-btn--danger">Revoke this invite</button>
				</form>
				{#if form?.revoke?.ok === false}
					<p class="amber-notice amber-notice--error after-action" role="alert">
						{@render alertIcon()}
						{form.revoke.error}
					</p>
				{/if}
				{#if form?.revoke?.ok === true}
					<p class="amber-notice amber-notice--ok after-action" role="status">
						{@render okIcon()}
						Invite revoked.
					</p>
				{/if}
			{/if}
		</section>
	{:else if state.kind === 'accept-as-current'}
		<section class="amber-panel">
			<p>
				You're signed in as <strong>{state.email}</strong>. Accept this invite to gain
				<strong>{state.invite.role}</strong> access to
				<strong>{state.invite.spaceTitle ?? state.invite.slug}</strong>?
			</p>
			<form method="POST" action="?/redeemAsCurrent" use:enhance>
				<button type="submit" class="amber-btn amber-btn--primary">Accept</button>
				{#if form?.redeem?.ok === false}
					<p class="amber-notice amber-notice--error after-action" role="alert">
						{@render alertIcon()}
						{form.redeem.error}
					</p>
				{/if}
			</form>
		</section>
	{/if}
</div>

<style>
	.invite {
		max-width: 42rem;
	}

	.alt {
		margin: 1rem 0 0;
		color: var(--amber-ink-muted);
		font-size: 0.9rem;
	}
	.alt a {
		color: var(--amber-accent);
	}
	.alt a:hover {
		color: var(--amber-accent-hover);
	}

	.after-action {
		margin-top: 0.8rem;
	}
</style>
