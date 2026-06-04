<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

{#snippet alertIcon()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
		<path
			d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
		/>
	</svg>
{/snippet}

<header class="amber-page-head">
	<div class="amber-page-head__text">
		<h1>Members of {data.spaceTitle}</h1>
		<p class="amber-page-head__lede">
			Owners and editors of this space, plus any pending invites you've sent.
		</p>
	</div>
</header>

<ul class="member-list">
	{#each data.members as m (m.userId)}
		<li class="member">
			<span class="email">{m.email}</span>

			<form method="POST" action="?/changeRole" use:enhance class="role-form">
				<input type="hidden" name="userId" value={m.userId} />
				<select class="amber-input role-select" name="role">
					<option value="editor" selected={m.role === 'editor'}>editor</option>
					<option value="owner" selected={m.role === 'owner'}>owner</option>
				</select>
				<button type="submit" class="amber-btn amber-btn--sm">Save</button>
			</form>

			<form method="POST" action="?/removeMember" use:enhance class="remove-form">
				<input type="hidden" name="userId" value={m.userId} />
				<button type="submit" class="amber-btn amber-btn--ghost amber-btn--sm">Remove</button>
			</form>
		</li>
	{:else}
		<li class="member-empty">
			No direct members yet. Owners and editors you invite will appear here.
		</li>
	{/each}
</ul>

<section class="amber-panel">
	<h2>Pending invites</h2>
	{#if data.invites.length === 0}
		<p class="empty">No pending invites.</p>
	{:else}
		<ul class="invite-list">
			{#each data.invites as inv (inv.id)}
				<li class="invite">
					<span class="invite-meta">
						<span class="amber-badge">{inv.role}</span>
						<span class="expires"
							>expires {new Date(inv.expires_at).toISOString().slice(0, 10)}</span
						>
					</span>
					<form method="POST" action="?/revokeInvite" use:enhance>
						<input type="hidden" name="inviteId" value={inv.id} />
						<button type="submit" class="amber-btn amber-btn--ghost amber-btn--sm">Revoke</button>
					</form>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<section class="amber-panel">
	<h2>Generate an invite</h2>
	<p class="amber-panel__hint">
		Create a single-use URL that grants the chosen role. It expires after seven days.
	</p>
	<form method="POST" action="?/generateInvite" use:enhance class="amber-form">
		<label class="amber-field">
			<span>Role</span>
			<select class="amber-input" name="role">
				<option value="editor">editor</option>
				<option value="owner">owner</option>
			</select>
		</label>
		<button type="submit" class="amber-btn amber-btn--primary">Generate URL</button>
	</form>

	{#if form?.generate?.ok}
		{@const inviteUrl = form.generate.inviteUrl}
		<aside class="amber-notice amber-notice--warn invite-url-once" role="status">
			{@render alertIcon()}
			<div class="invite-url-once__body">
				<p>Send this URL to the invitee. <strong>It will not be shown again.</strong></p>
				<div class="invite-url-once__row">
					<input
						class="amber-input"
						type="text"
						readonly
						value={inviteUrl}
						aria-label="Invite URL"
					/>
					<button
						type="button"
						class="amber-btn amber-btn--ghost amber-btn--sm"
						onclick={() => navigator.clipboard.writeText(inviteUrl)}
					>
						Copy
					</button>
				</div>
			</div>
		</aside>
	{/if}
	{#if form?.generate?.ok === false}
		<p class="amber-notice amber-notice--error after-action" role="alert">
			{@render alertIcon()}
			{form.generate.error}
		</p>
	{/if}
</section>

<style>
	/* Members: an entity-with-controls grid mirroring the users page's `.user-list`. */
	.member-list {
		list-style: none;
		margin: 0 0 1.75rem;
		padding: 0;
		border: 1px solid var(--amber-rule);
		border-radius: 10px;
		overflow: hidden;
	}
	.member {
		display: grid;
		grid-template-columns: 1fr auto auto;
		align-items: center;
		gap: 0.4rem 1rem;
		padding: 0.9rem 1.1rem;
	}
	.member + .member {
		border-top: 1px solid var(--amber-rule);
	}
	.member-empty {
		padding: 0.9rem 1.1rem;
		color: var(--amber-ink-muted);
		font-size: 0.9rem;
	}

	.email {
		min-width: 0;
		font-weight: 600;
		color: var(--amber-ink);
		overflow-wrap: anywhere;
	}

	.role-form {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	/* A <select> is narrow content — don't let it stretch like a text field. */
	.role-select {
		width: auto;
		min-width: 7rem;
	}

	.remove-form {
		justify-self: end;
	}

	/* On narrow screens the row collapses: email on its own line, controls wrap
	   under it. */
	@media (max-width: 34rem) {
		.member {
			grid-template-columns: 1fr auto;
		}
		.email {
			grid-column: 1 / -1;
		}
	}

	/* Pending invites: lighter rows inside the panel. */
	.invite-list {
		list-style: none;
		margin: 0;
		padding: 0;
		border: 1px solid var(--amber-rule);
		border-radius: 10px;
		overflow: hidden;
	}
	.invite {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.75rem 1rem;
	}
	.invite + .invite {
		border-top: 1px solid var(--amber-rule);
	}
	.invite-meta {
		display: flex;
		align-items: center;
		gap: 0.6rem;
		min-width: 0;
	}
	.expires {
		color: var(--amber-ink-muted);
		font-size: 0.88rem;
	}
	.empty {
		margin: 0;
		color: var(--amber-ink-muted);
		font-size: 0.9rem;
	}

	.after-action {
		margin-top: 0.8rem;
	}

	/* Invite-URL callout: the warn notice holds a body that stacks the copy and
	   the read-only URL row. */
	.invite-url-once {
		margin-top: 0.8rem;
	}
	.invite-url-once__body {
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
		min-width: 0;
		flex: 1;
	}
	.invite-url-once__body p {
		margin: 0;
	}
	.invite-url-once__row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.invite-url-once__row .amber-input {
		flex: 1;
		min-width: 0;
		color: var(--amber-ink);
	}
</style>
