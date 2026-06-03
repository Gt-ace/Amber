<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';

	let { data, form }: { data: PageData; form: ActionData } = $props();
	const state = $derived(data.state);
</script>

<h1>You've been invited</h1>

{#if state.kind === 'signed-out'}
	<p>
		You've been invited as <strong>{state.invite.role}</strong> on
		<strong>{state.invite.spaceTitle ?? state.invite.slug}</strong>.
	</p>
	<form method="POST" action="?/redeemAsNew" use:enhance>
		<label>Email <input name="email" type="email" required /></label>
		<label
			>Password (8+ chars) <input name="password" type="password" minlength="8" required /></label
		>
		<label>Name <input name="name" type="text" /></label>
		<button type="submit">Create account and accept</button>
		{#if form?.redeem?.ok === false}
			<p role="alert">{form.redeem.error}</p>
		{/if}
	</form>
	{#if data.googleEnabled}
		<!-- /api/auth/* is handled by better-auth's svelteKitHandler, not a SvelteKit route. -->
		<!-- eslint-disable svelte/no-navigation-without-resolve -->
		<a
			href="/api/auth/sign-in/social/google?callbackURL={encodeURIComponent(
				'/admin/invite/' + page.params.token + '?gstate=' + data.inviteSignedState
			)}"
		>
			Continue with Google
		</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	{/if}
	<p>
		Already have an account?
		<a
			href="{resolve('/admin/login')}?next={encodeURIComponent(
				'/admin/invite/' + page.params.token
			)}">Sign in to claim.</a
		>
	</p>
{:else if state.kind === 'install-admin'}
	<p>
		You're the install-admin — you already have access to every space, including
		<strong>{state.invite.spaceTitle ?? state.invite.slug}</strong>. This invite is intact.
	</p>
	<form method="POST" action="?/revokeIfAdmin" use:enhance>
		<button type="submit">Revoke this invite</button>
	</form>
{:else if state.kind === 'already-member'}
	<p>
		You already have <strong>{state.currentRole}</strong> access to
		<strong>{state.invite.spaceTitle ?? state.invite.slug}</strong>. This invite is still pending
		and can be passed on or revoked.
	</p>
	{#if state.currentRole === 'owner'}
		<form method="POST" action="?/revokeIfOwner" use:enhance>
			<button type="submit">Revoke this invite</button>
		</form>
		{#if form?.revoke?.ok === false}
			<p role="alert">{form.revoke.error}</p>
		{/if}
		{#if form?.revoke?.ok === true}
			<p>Invite revoked.</p>
		{/if}
	{/if}
{:else if state.kind === 'accept-as-current'}
	<p>
		You're signed in as <strong>{state.email}</strong>. Accept this invite to gain
		<strong>{state.invite.role}</strong> access to
		<strong>{state.invite.spaceTitle ?? state.invite.slug}</strong>?
	</p>
	<form method="POST" action="?/redeemAsCurrent" use:enhance>
		<button type="submit">Accept</button>
		{#if form?.redeem?.ok === false}
			<p role="alert">{form.redeem.error}</p>
		{/if}
	</form>
{/if}
