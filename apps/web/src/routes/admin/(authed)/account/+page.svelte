<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';
	let { data, form }: { data: PageData; form: ActionData } = $props();

	const initial = $derived(((data.user.name?.trim() || data.user.email)[0] ?? '?').toUpperCase());
	let changing = $state(false);
</script>

<svelte:head>
	<title>Account · Amber admin</title>
</svelte:head>

<div class="account">
	<header class="amber-page-head">
		<div class="amber-page-head__text">
			<h1>Account</h1>
			<p class="amber-page-head__lede">Manage how you sign in to this Amber install.</p>
		</div>
	</header>

	<div class="identity">
		<span class="avatar" aria-hidden="true">{initial}</span>
		<div class="identity__who">
			{#if data.user.name}
				<span class="identity__name">{data.user.name}</span>
			{/if}
			<span class="identity__email">{data.user.email}</span>
		</div>
		<span class="amber-badge {data.isInstallAdmin ? 'amber-badge--accent' : ''}">
			{data.isInstallAdmin ? 'Install admin' : 'User'}
		</span>
	</div>

	<section class="amber-panel">
		<h2>Change password</h2>
		<p class="amber-panel__hint">Changing it signs you out of every other device.</p>
		<form
			method="post"
			action="?/changePassword"
			use:enhance={() => {
				changing = true;
				return async ({ update }) => {
					await update();
					changing = false;
				};
			}}
			class="amber-form"
		>
			<label class="amber-field">
				<span>Current password</span>
				<input
					class="amber-input"
					type="password"
					name="currentPassword"
					autocomplete="current-password"
					required
				/>
			</label>
			<label class="amber-field">
				<span>
					New password
					<span class="amber-field__hint">At least 8 characters.</span>
				</span>
				<input
					class="amber-input"
					type="password"
					name="newPassword"
					autocomplete="new-password"
					minlength="8"
					required
				/>
			</label>
			{#if form?.changePassword?.error}
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
					{form.changePassword.error}
				</p>
			{:else if form?.changePassword?.ok}
				<p class="amber-notice amber-notice--ok" role="status">
					<svg
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						aria-hidden="true"
					>
						<path d="M20 6 9 17l-5-5" />
					</svg>
					Password updated. Other sessions were signed out.
				</p>
			{/if}
			<button type="submit" class="amber-btn amber-btn--primary" disabled={changing}>
				{changing ? 'Changing…' : 'Change password'}
			</button>
		</form>
	</section>

	{#if data.googleEnabled}
		<section class="amber-panel">
			<h2>Google account</h2>
			{#if data.googleLinked}
				<p class="amber-panel__hint">Google is linked as a backup sign-in method.</p>
				<form method="post" action="?/unlinkGoogle" use:enhance>
					<button type="submit" class="amber-btn amber-btn--ghost">Unlink Google</button>
				</form>
				{#if form?.unlinkGoogle?.error}
					<p class="amber-notice amber-notice--error after-action" role="alert">
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
						{form.unlinkGoogle.error}
					</p>
				{:else if form?.unlinkGoogle?.ok}
					<p class="amber-notice amber-notice--ok after-action" role="status">
						<svg
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M20 6 9 17l-5-5" />
						</svg>
						Google unlinked.
					</p>
				{/if}
			{:else}
				<p class="amber-panel__hint">Link Google to use it as a backup sign-in method.</p>
				<form method="post" action="?/linkGoogle">
					<button type="submit" class="amber-btn amber-btn--ghost">Link Google</button>
				</form>
			{/if}
		</section>
	{/if}

	{#if !data.isInstallAdmin}
		<section class="amber-panel danger">
			<h2>Delete my account</h2>
			<p class="amber-panel__hint">
				This permanently removes your access to every space and erases your account. It cannot be
				undone.
			</p>
			<details class="confirm">
				<summary class="amber-btn amber-btn--danger">Delete my account…</summary>
				<form method="POST" action="?/deleteSelf" use:enhance class="confirm-body">
					<label class="amber-field">
						<span>
							Type <strong>{data.user.email}</strong> to confirm
						</span>
						<input
							class="amber-input"
							name="confirmEmail"
							type="email"
							autocomplete="off"
							placeholder={data.user.email}
							required
						/>
					</label>
					{#if form?.deleteSelf?.ok === false}
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
							{form.deleteSelf.error}
						</p>
					{/if}
					<button type="submit" class="amber-btn amber-btn--danger">Permanently delete</button>
				</form>
			</details>
		</section>
	{:else}
		<section class="amber-panel">
			<h2>Delete my account</h2>
			<p class="amber-panel__hint">
				The install-admin can't self-delete here. Hand the role over with
				<code>bin/grant-ownership.ts</code> first.
			</p>
		</section>
	{/if}
</div>

<style>
	.account {
		max-width: 42rem;
	}

	.identity {
		display: flex;
		align-items: center;
		gap: 0.85rem;
		padding: 0.9rem 1.1rem;
		margin-bottom: 1.25rem;
		border: 1px solid var(--amber-rule);
		border-radius: 10px;
		background: var(--amber-surface-sunken);
	}
	.avatar {
		display: grid;
		place-items: center;
		flex: 0 0 auto;
		width: 2.75rem;
		height: 2.75rem;
		border-radius: 50%;
		background: var(--amber-bg);
		border: 1px solid var(--amber-rule);
		color: var(--amber-accent);
		font-family: var(--amber-font-display);
		font-weight: 600;
		font-size: 1.2rem;
		user-select: none;
	}
	.identity__who {
		min-width: 0;
		display: flex;
		flex-direction: column;
		line-height: 1.3;
	}
	.identity__name {
		font-weight: 600;
		overflow-wrap: anywhere;
	}
	.identity__email {
		color: var(--amber-ink-muted);
		font-size: 0.9rem;
		overflow-wrap: anywhere;
	}
	.identity .amber-badge {
		margin-left: auto;
	}

	.after-action {
		margin-top: 0.8rem;
	}

	/* Danger zone — tinted to read as set-apart and destructive. */
	.danger {
		border-color: color-mix(in srgb, var(--amber-danger) 45%, var(--amber-rule));
		background: var(--amber-danger-surface);
	}
	.danger h2 {
		color: var(--amber-danger);
	}

	.confirm summary {
		list-style: none;
		width: fit-content;
	}
	.confirm summary::-webkit-details-marker {
		display: none;
	}
	.confirm-body {
		margin-top: 0.9rem;
		display: flex;
		flex-direction: column;
		gap: 0.8rem;
		align-items: flex-start;
		max-width: 24rem;
	}
	.confirm-body .amber-field {
		width: 100%;
	}
	code {
		font-size: 0.85em;
		background: var(--amber-bg);
		border: 1px solid var(--amber-rule);
		border-radius: 4px;
		padding: 0.05rem 0.3rem;
	}
</style>
