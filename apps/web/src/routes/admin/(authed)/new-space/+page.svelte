<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { resolve } from '$app/paths';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let title = $state(form?.raw?.title ?? '');
	let slug = $state(form?.raw?.slug ?? '');
	let slugDirty = $state(false);
	let routingKind = $state<'prefix' | 'host' | 'default' | 'admin-only'>(
		(form?.raw?.routingKind as 'prefix' | 'host' | 'default' | 'admin-only') ?? 'prefix'
	);
	let host = $state(form?.raw?.host ?? '');
	let prefix = $state(form?.raw?.prefix ?? '');
	let submitting = $state(false);

	function derive(t: string): string {
		return t
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-+/, '')
			.slice(0, 63);
	}

	$effect(() => {
		if (!slugDirty) slug = derive(title);
	});

	$effect(() => {
		if (routingKind === 'prefix' && prefix === '' && slug) prefix = `/${slug}`;
	});

	function errorFor(field: 'title' | 'slug' | 'host' | 'prefix' | 'default'): string | null {
		if (!form || !('errors' in form) || !form.errors) return null;
		const e = form.errors.find((x) => x.field === field);
		if (!e) return null;
		switch (e.code) {
			case 'title_empty': return 'Title is required.';
			case 'slug_invalid': return 'Use lowercase letters, digits, and hyphens. Must start with a letter or digit.';
			case 'slug_taken': return `A directory named "${slug}" already exists. Choose another name.`;
			case 'host_invalid': return 'Bare host only, no scheme or port. Example: notes.example.com.';
			case 'host_is_admin': return 'This is the admin host. The admin/auth endpoints always win here — pick a different host.';
			case 'host_taken': return `"${host}" is already used by another space.`;
			case 'prefix_invalid': return 'Path like /notes. No trailing slash.';
			case 'prefix_reserved': return `"${prefix}" collides with a reserved Amber path.`;
			case 'prefix_taken': return `"${prefix}" is already used by another space.`;
			case 'default_taken': return 'A default space already exists.';
		}
		return null;
	}

	const writeError = form && 'writeError' in form ? form.writeError : null;
</script>

<svelte:head>
	<title>New space — Amber admin</title>
</svelte:head>

<h1>New space</h1>
<p class="hint">Creates a directory under your spaces folder, scaffolds <code>amber.toml</code> and <code>index.md</code>, and (if you pick host or path routing) writes <code>space.toml</code>. The new space is hot-added — no restart.</p>

<form method="POST" onsubmit={() => (submitting = true)}>
	<div class="field">
		<label for="title">Title</label>
		<input
			id="title"
			name="title"
			type="text"
			bind:value={title}
			required
			autofocus
			aria-invalid={errorFor('title') ? 'true' : undefined}
		/>
		{#if errorFor('title')}
			<p class="err" role="alert" aria-live="polite">{errorFor('title')}</p>
		{/if}
	</div>

	<div class="field">
		<label for="slug">Slug</label>
		<input
			id="slug"
			name="slug"
			type="text"
			bind:value={slug}
			oninput={() => (slugDirty = true)}
			required
			pattern={"^[a-z0-9][a-z0-9-]{0,62}$"}
			aria-invalid={errorFor('slug') ? 'true' : undefined}
		/>
		<p class="hint">Becomes the directory name and <code>/admin/spaces/{slug || '<slug>'}</code>.</p>
		{#if errorFor('slug')}
			<p class="err" role="alert" aria-live="polite">{errorFor('slug')}</p>
		{/if}
	</div>

	<fieldset class="field">
		<legend>How is it reached?</legend>

		<label class="row">
			<input type="radio" name="routingKind" value="prefix" bind:group={routingKind} />
			<span class="row-main">Path prefix on the default site</span>
			<span class="row-sub">Mounted under a path on the install's default host.</span>
		</label>
		{#if routingKind === 'prefix'}
			<div class="reveal">
				<label for="prefix" class="sublabel">Prefix</label>
				<input id="prefix" name="prefix" type="text" bind:value={prefix} aria-invalid={errorFor('prefix') ? 'true' : undefined} />
				<p class="hint">Path the space is mounted at, e.g. <code>/notes</code>.</p>
				{#if errorFor('prefix')}
					<p class="err" role="alert" aria-live="polite">{errorFor('prefix')}</p>
				{/if}
			</div>
		{/if}

		<label class="row">
			<input type="radio" name="routingKind" value="host" bind:group={routingKind} />
			<span class="row-main">Its own host</span>
			<span class="row-sub">Served at a separate domain name.</span>
		</label>
		{#if routingKind === 'host'}
			<div class="reveal">
				<label for="host" class="sublabel">Host</label>
				<input id="host" name="host" type="text" bind:value={host} placeholder="notes.example.com" aria-invalid={errorFor('host') ? 'true' : undefined} />
				<p class="hint">Bare host, no scheme or port.</p>
				{#if errorFor('host')}
					<p class="err" role="alert" aria-live="polite">{errorFor('host')}</p>
				{/if}
			</div>
		{/if}

		<label class="row" class:disabled={data.defaultOwner !== null}>
			<input type="radio" name="routingKind" value="default" bind:group={routingKind} disabled={data.defaultOwner !== null} />
			<span class="row-main">This is the default site</span>
			<span class="row-sub">
				{#if data.defaultOwner !== null}
					Currently: <code>{data.defaultOwner}</code>.
				{:else}
					Catches every request that doesn't match a host or prefix.
				{/if}
			</span>
		</label>
		{#if errorFor('default')}
			<p class="err" role="alert" aria-live="polite">{errorFor('default')}</p>
		{/if}

		<label class="row">
			<input type="radio" name="routingKind" value="admin-only" bind:group={routingKind} />
			<span class="row-main">Admin-only for now</span>
			<span class="row-sub">Loads into the admin but doesn't serve public traffic yet. Add <code>host</code> or <code>prefix</code> to <code>space.toml</code> later.</span>
		</label>
	</fieldset>

	{#if writeError === 'permission_denied'}
		<p class="form-err" role="alert">Amber doesn't have write access to your spaces directory. Fix the directory permissions and try again.</p>
	{:else if writeError === 'write_failed'}
		<p class="form-err" role="alert">Couldn't create the space. Check the server logs for details.</p>
	{:else if writeError === 'dir_already_exists'}
		<p class="form-err" role="alert">A directory with this slug already exists.</p>
	{/if}

	<div class="actions">
		<button type="submit" disabled={submitting}>
			{submitting ? 'Creating…' : 'Create space'}
		</button>
		<a href={resolve('/admin')} class="cancel">Cancel</a>
	</div>
</form>

<style>
	h1 {
		margin-bottom: 0.25rem;
	}
	.hint {
		color: #777;
		font-size: 0.9rem;
		margin-top: 0.25rem;
	}
	form {
		max-width: 36rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin-top: 1.5rem;
	}
	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}
	label {
		font-weight: 500;
	}
	input[type='text'] {
		font: inherit;
		padding: 0.5rem 0.6rem;
		border: 1px solid #ccc;
		border-radius: 4px;
		min-height: 2.5rem;
	}
	input[aria-invalid='true'] {
		border-color: #b00020;
	}
	fieldset {
		border: 1px solid #ddd;
		border-radius: 4px;
		padding: 0.75rem 1rem 1rem;
	}
	legend {
		padding: 0 0.25rem;
		font-weight: 500;
	}
	.row {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto;
		gap: 0.2rem 0.6rem;
		padding: 0.5rem 0;
		font-weight: 400;
		cursor: pointer;
	}
	.row.disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
	.row input[type='radio'] {
		grid-row: 1 / span 2;
		align-self: start;
		margin-top: 0.2rem;
	}
	.row-main {
		font-weight: 500;
	}
	.row-sub {
		color: #777;
		font-size: 0.88rem;
	}
	.reveal {
		margin: 0.25rem 0 0.5rem 1.7rem;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
		animation: slide-in 200ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	@keyframes slide-in {
		from { opacity: 0; transform: translateY(8px); }
		to   { opacity: 1; transform: translateY(0);    }
	}
	.sublabel {
		font-weight: 500;
		font-size: 0.9rem;
	}
	.err {
		color: #b00020;
		font-size: 0.88rem;
		margin: 0;
	}
	.form-err {
		color: #b00020;
		background: #fdecef;
		border: 1px solid #f4c1cc;
		padding: 0.6rem 0.8rem;
		border-radius: 4px;
		font-size: 0.9rem;
		margin: 0;
	}
	.actions {
		display: flex;
		gap: 0.8rem;
		align-items: center;
	}
	button {
		font: inherit;
		font-weight: 500;
		padding: 0.55rem 1rem;
		border: 1px solid #333;
		border-radius: 4px;
		background: #333;
		color: #fff;
		cursor: pointer;
		min-height: 2.5rem;
		transition: transform 160ms cubic-bezier(0.23, 1, 0.32, 1);
	}
	button:active {
		transform: scale(0.97);
	}
	button:disabled {
		opacity: 0.6;
		cursor: progress;
	}
	.cancel {
		color: #555;
		text-decoration: none;
	}
	.cancel:hover {
		text-decoration: underline;
	}
</style>
