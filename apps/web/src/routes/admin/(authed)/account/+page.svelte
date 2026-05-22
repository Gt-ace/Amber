<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<svelte:head>
	<title>Account · Amber admin</title>
</svelte:head>

<h1>Account</h1>
<p>
	Signed in as <strong>{data.user.email}</strong>.
</p>

<section class="amber-card">
	<h2>Change password</h2>
	<form method="post" action="?/changePassword" use:enhance class="amber-auth-form">
		<label>
			Current password
			<input type="password" name="currentPassword" autocomplete="current-password" required />
		</label>
		<label>
			New password
			<input
				type="password"
				name="newPassword"
				autocomplete="new-password"
				minlength="8"
				required
			/>
		</label>
		{#if form?.changePassword?.error}
			<p class="amber-form-error" role="alert">{form.changePassword.error}</p>
		{:else if form?.changePassword?.ok}
			<p class="amber-form-ok" role="status">Password updated. Other sessions were signed out.</p>
		{/if}
		<button type="submit">Change password</button>
	</form>
</section>

{#if data.googleEnabled}
	<section class="amber-card">
		<h2>Google account</h2>
		{#if data.googleLinked}
			<p>Google is linked to this admin account.</p>
			<form method="post" action="?/unlinkGoogle" use:enhance>
				<button type="submit">Unlink Google</button>
			</form>
			{#if form?.unlinkGoogle?.error}
				<p class="amber-form-error" role="alert">{form.unlinkGoogle.error}</p>
			{:else if form?.unlinkGoogle?.ok}
				<p class="amber-form-ok" role="status">Google unlinked.</p>
			{/if}
		{:else}
			<p>Link Google to use it as a backup sign-in method.</p>
			<form method="post" action="?/linkGoogle">
				<button type="submit">Link Google</button>
			</form>
		{/if}
	</section>
{/if}

{#if !data.isInstallAdmin}
	<section class="danger-zone">
		<h2>Delete my account</h2>
		<p>This permanently removes your access to every space and erases your account.</p>
		<form method="POST" action="?/deleteSelf" use:enhance>
			<label>
				Type your email to confirm:
				<input name="confirmEmail" type="email" required />
			</label>
			<button type="submit">Delete my account</button>
		</form>
		{#if form?.deleteSelf?.ok === false}
			<p role="alert">{form.deleteSelf.error}</p>
		{/if}
	</section>
{:else}
	<p><em>The install-admin cannot self-delete through the UI.</em></p>
{/if}

<style>
	.amber-card {
		border: 1px solid #ddd;
		padding: 1rem;
		border-radius: 6px;
		margin: 1.25rem 0;
	}
	.amber-card h2 {
		margin-top: 0;
	}
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
	button {
		padding: 0.55rem 0.9rem;
		font: inherit;
		cursor: pointer;
	}
	.amber-form-error {
		color: #a40000;
		margin: 0;
	}
	.amber-form-ok {
		color: #006400;
		margin: 0;
	}
</style>
