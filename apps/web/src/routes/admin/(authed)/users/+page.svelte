<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { enhance } from '$app/forms';

	let { data, form }: { data: PageData; form: ActionData } = $props();
</script>

<h1>Users</h1>
<table>
	<thead>
		<tr><th>Email</th><th>Tier</th><th>Last sign-in</th><th>Spaces</th><th>Actions</th></tr>
	</thead>
	<tbody>
		{#each data.users as u (u.id)}
			<tr>
				<td>{u.email}</td>
				<td>{u.isInstallAdmin ? 'install-admin' : 'user'}</td>
				<td>{u.lastSignIn ? new Date(u.lastSignIn).toISOString().slice(0, 10) : '—'}</td>
				<td>{u.memberships}</td>
				<td>
					{#if !u.isInstallAdmin}
						<form method="POST" action="?/deleteUser" use:enhance>
							<input type="hidden" name="userId" value={u.id} />
							<input type="text" name="confirmEmail" placeholder="type email to confirm" required />
							<button type="submit">Delete</button>
						</form>
					{:else}
						<span aria-disabled="true">CLI only</span>
					{/if}
				</td>
			</tr>
		{/each}
	</tbody>
</table>
{#if form?.delete?.ok === false}
	<p role="alert">{form.delete.error}</p>
{/if}
