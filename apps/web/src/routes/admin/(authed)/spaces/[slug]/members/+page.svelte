<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<h1>Members of {data.spaceTitle}</h1>

<section>
	<h2>Members</h2>
	<table>
		<thead>
			<tr><th>Email</th><th>Role</th><th>Actions</th></tr>
		</thead>
		<tbody>
			{#each data.members as m (m.userId)}
				<tr>
					<td>{m.email}</td>
					<td>
						<form method="POST" action="?/changeRole" use:enhance>
							<input type="hidden" name="userId" value={m.userId} />
							<select name="role">
								<option value="editor" selected={m.role === 'editor'}>editor</option>
								<option value="owner" selected={m.role === 'owner'}>owner</option>
							</select>
							<button type="submit">Save</button>
						</form>
					</td>
					<td>
						<form method="POST" action="?/removeMember" use:enhance>
							<input type="hidden" name="userId" value={m.userId} />
							<button type="submit">Remove</button>
						</form>
					</td>
				</tr>
			{/each}
		</tbody>
	</table>
</section>

<section>
	<h2>Pending invites</h2>
	<ul>
		{#each data.invites as inv (inv.id)}
			<li>
				role={inv.role}, expires {new Date(inv.expires_at).toISOString().slice(0, 10)}
				<form method="POST" action="?/revokeInvite" use:enhance>
					<input type="hidden" name="inviteId" value={inv.id} />
					<button type="submit">Revoke</button>
				</form>
			</li>
		{/each}
	</ul>

	<h3>Generate an invite</h3>
	<form method="POST" action="?/generateInvite" use:enhance>
		<label>
			Role:
			<select name="role">
				<option value="editor">editor</option>
				<option value="owner">owner</option>
			</select>
		</label>
		<button type="submit">Generate URL</button>
	</form>

	{#if form?.generate?.ok}
		<aside class="invite-url-once">
			<p>Send this URL to the invitee. <strong>It will not be shown again.</strong></p>
			<input type="text" readonly value={form.generate.inviteUrl} aria-label="Invite URL" />
			<button type="button" onclick={() => navigator.clipboard.writeText(form.generate.inviteUrl)}>
				Copy
			</button>
		</aside>
	{/if}
	{#if form?.generate?.ok === false}
		<p role="alert">{form.generate.error}</p>
	{/if}
</section>
