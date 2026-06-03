<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	function initial(email: string, name: string | null): string {
		const source = name?.trim() || email;
		return (source[0] ?? '?').toUpperCase();
	}

	function lastSeen(ms: number | null): string {
		if (!ms) return 'Never signed in';
		const when = new Date(ms).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
		return `Last seen ${when}`;
	}

	function spaceCount(n: number): string {
		if (n === 0) return 'No spaces';
		return `${n} ${n === 1 ? 'space' : 'spaces'}`;
	}

	const total = $derived(data.users.length);
	const adminCount = $derived(data.users.filter((u) => u.isInstallAdmin).length);
</script>

<svelte:head>
	<title>Users · Amber admin</title>
</svelte:head>

<header class="amber-page-head">
	<div class="amber-page-head__text">
		<h1>Users</h1>
		<p class="amber-page-head__lede">
			Everyone with an account on this install. The install-admin tier spans every space and can
			only be changed from the CLI.
		</p>
	</div>
	<p class="count">
		{total}
		{total === 1 ? 'user' : 'users'}{adminCount ? ` · ${adminCount} admin` : ''}
	</p>
</header>

{#if form?.delete?.ok === false}
	<p class="amber-notice amber-notice--error" role="alert">
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
			<path
				d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
			/>
		</svg>
		{form.delete.error}
	</p>
{/if}

<ul class="user-list">
	{#each data.users as u (u.id)}
		<li class="user">
			<span class="avatar" aria-hidden="true">{initial(u.email, u.name)}</span>
			<div class="who">
				{#if u.name}
					<span class="name">{u.name}</span>
					<span class="email">{u.email}</span>
				{:else}
					<span class="name">{u.email}</span>
				{/if}
				<span class="meta">{lastSeen(u.lastSignIn)} · {spaceCount(u.memberships)}</span>
			</div>

			<span class="amber-badge {u.isInstallAdmin ? 'amber-badge--accent' : ''}">
				{u.isInstallAdmin ? 'Install admin' : 'User'}
			</span>

			<div class="action">
				{#if u.isInstallAdmin}
					<span class="cli-only" title="Use bin/grant-ownership.ts to change the install-admin">
						CLI only
					</span>
				{:else}
					<details class="confirm">
						<summary class="amber-btn amber-btn--ghost amber-btn--sm">Delete…</summary>
						<form method="POST" action="?/deleteUser" use:enhance class="confirm-body">
							<input type="hidden" name="userId" value={u.id} />
							<label class="amber-field">
								<span>
									Type <strong>{u.email}</strong> to confirm
									<span class="amber-field__hint">This permanently removes the account.</span>
								</span>
								<input
									class="amber-input"
									type="text"
									name="confirmEmail"
									autocomplete="off"
									placeholder={u.email}
									required
								/>
							</label>
							<button type="submit" class="amber-btn amber-btn--danger amber-btn--sm">
								Delete user
							</button>
						</form>
					</details>
				{/if}
			</div>
		</li>
	{/each}
</ul>

<style>
	.count {
		margin: 0;
		color: var(--amber-ink-muted);
		font-size: 0.85rem;
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
	}

	.user-list {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--amber-rule);
		border-radius: 10px;
		overflow: hidden;
	}
	.user {
		display: grid;
		grid-template-columns: auto 1fr auto auto;
		align-items: center;
		gap: 0.4rem 1rem;
		padding: 0.9rem 1.1rem;
	}
	.user + .user {
		border-top: 1px solid var(--amber-rule);
	}

	.avatar {
		display: grid;
		place-items: center;
		width: 2.5rem;
		height: 2.5rem;
		border-radius: 50%;
		background: var(--amber-surface-sunken);
		border: 1px solid var(--amber-rule);
		color: var(--amber-accent);
		font-family: var(--amber-font-display);
		font-weight: 600;
		font-size: 1.1rem;
		user-select: none;
	}

	.who {
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 0.05rem;
	}
	.name {
		font-weight: 600;
		color: var(--amber-ink);
		overflow-wrap: anywhere;
	}
	.email {
		font-size: 0.88rem;
		color: var(--amber-ink-muted);
		overflow-wrap: anywhere;
	}
	.meta {
		font-size: 0.8rem;
		color: var(--amber-ink-muted);
		margin-top: 0.15rem;
	}

	.cli-only {
		font-size: 0.78rem;
		color: var(--amber-ink-muted);
		font-style: italic;
	}

	/* Progressive-disclosure delete confirm: native <details>, works with JS off. */
	.confirm {
		justify-self: end;
	}
	.confirm summary {
		list-style: none;
	}
	.confirm summary::-webkit-details-marker {
		display: none;
	}
	.confirm[open] summary {
		background: var(--amber-bg);
		border-color: var(--amber-ink-muted);
	}
	.confirm-body {
		margin-top: 0.75rem;
		display: flex;
		flex-direction: column;
		gap: 0.7rem;
		align-items: flex-start;
		width: min(22rem, 70vw);
	}
	.confirm-body .amber-field {
		width: 100%;
	}

	/* On narrow screens the row collapses: identity stacks, badge + action wrap
	   under it on their own line. */
	@media (max-width: 34rem) {
		.user {
			grid-template-columns: auto 1fr;
		}
		.user > .amber-badge {
			grid-column: 2;
			justify-self: start;
		}
		.action {
			grid-column: 1 / -1;
		}
		.confirm {
			justify-self: stretch;
		}
		.confirm-body {
			width: 100%;
		}
	}
</style>
