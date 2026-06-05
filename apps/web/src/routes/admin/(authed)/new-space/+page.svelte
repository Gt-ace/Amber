<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { resolve } from '$app/paths';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	function derive(t: string): string {
		return t
			.toLowerCase()
			.replace(/[^a-z0-9-]+/g, '-')
			.replace(/-+/g, '-')
			.replace(/^-+/, '')
			.slice(0, 63);
	}

	let title = $state(form?.raw?.title ?? '');
	let slug = $state(form?.raw?.slug ?? '');
	// If the form's previous submission had a slug that didn't match what
	// the title would have derived, the user hand-edited it — preserve
	// `slugDirty: true` across the re-render so the next title edit doesn't
	// silently overwrite their slug choice.
	let slugDirty = $state(form?.raw?.slug != null && form.raw.slug !== derive(form.raw.title ?? ''));
	let routingKind = $state<'prefix' | 'host' | 'default' | 'admin-only'>(
		(form?.raw?.routingKind as 'prefix' | 'host' | 'default' | 'admin-only') ?? 'prefix'
	);
	let host = $state(form?.raw?.host ?? '');
	let prefix = $state(form?.raw?.prefix ?? '');
	let submitting = $state(false);

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
			case 'title_empty':
				return 'Title is required.';
			case 'slug_invalid':
				return 'Use lowercase letters, digits, and hyphens. Must start with a letter or digit.';
			case 'slug_taken':
				return `A directory named "${slug}" already exists. Choose another name.`;
			case 'host_invalid':
				return 'Bare host only, no scheme or port. Example: notes.example.com.';
			case 'host_is_admin':
				return 'This is the admin host. The admin/auth endpoints always win here. Pick a different host.';
			case 'host_taken':
				return `"${host}" is already used by another space.`;
			case 'prefix_invalid':
				return 'Path like /notes. No trailing slash.';
			case 'prefix_reserved':
				return `"${prefix}" collides with a reserved Amber path.`;
			case 'prefix_taken':
				return `"${prefix}" is already used by another space.`;
			case 'default_taken':
				return 'A default space already exists.';
		}
		return null;
	}

	const writeError = form && 'writeError' in form ? form.writeError : null;
</script>

<svelte:head>
	<title>New space · Amber admin</title>
</svelte:head>

{#snippet alertIcon()}
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
		<path
			d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"
		/>
	</svg>
{/snippet}

<header class="amber-page-head">
	<div class="amber-page-head__text">
		<h1>New space</h1>
		<p class="amber-page-head__lede">
			Creates a directory under your spaces folder, scaffolds <code>amber.toml</code> and
			<code>index.md</code>, and (if you pick host or path routing) writes
			<code>space.toml</code>. The new space is hot-added, no restart needed.
		</p>
	</div>
</header>

<form method="POST" onsubmit={() => (submitting = true)} class="new-space-form">
	<div class="field">
		<label class="amber-field">
			<span>Title</span>
			<input
				class="amber-input"
				id="title"
				name="title"
				type="text"
				bind:value={title}
				required
				autofocus
				aria-invalid={errorFor('title') ? 'true' : undefined}
			/>
		</label>
		{#if errorFor('title')}
			<p class="err" role="alert" aria-live="polite">{errorFor('title')}</p>
		{/if}
	</div>

	<div class="field">
		<label class="amber-field">
			<span>
				Slug
				<span class="amber-field__hint">
					Becomes the directory name and <code>/admin/spaces/{slug || '<slug>'}</code>.
				</span>
			</span>
			<input
				class="amber-input"
				id="slug"
				name="slug"
				type="text"
				bind:value={slug}
				oninput={() => (slugDirty = true)}
				required
				pattern={'^[a-z0-9][a-z0-9-]{0,62}$'}
				aria-invalid={errorFor('slug') ? 'true' : undefined}
			/>
		</label>
		{#if errorFor('slug')}
			<p class="err" role="alert" aria-live="polite">{errorFor('slug')}</p>
		{/if}
	</div>

	<fieldset class="routing">
		<legend>How is it reached?</legend>

		<label class="row">
			<input type="radio" name="routingKind" value="prefix" bind:group={routingKind} />
			<span class="row-main">Path prefix on the default site</span>
			<span class="row-sub">Mounted under a path on the install's default host.</span>
		</label>
		{#if routingKind === 'prefix'}
			<div class="reveal">
				<label for="prefix" class="sublabel">Prefix</label>
				<input
					class="amber-input"
					id="prefix"
					name="prefix"
					type="text"
					bind:value={prefix}
					aria-invalid={errorFor('prefix') ? 'true' : undefined}
				/>
				<p class="hint">Path the space is mounted at, e.g. <code>/notes</code>.</p>
				{#if prefix.startsWith('/') && prefix.length > 1}
					<p class="preview">
						Will serve at <code>{data.adminScheme}//{data.adminHost}{prefix}</code>
					</p>
				{/if}
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
				<input
					class="amber-input"
					id="host"
					name="host"
					type="text"
					bind:value={host}
					placeholder="notes.example.com"
					aria-invalid={errorFor('host') ? 'true' : undefined}
				/>
				<p class="hint">Bare host, no scheme or port.</p>
				{#if host}
					<p class="preview">Will serve at <code>{data.adminScheme}//{host}</code></p>
				{/if}
				{#if errorFor('host')}
					<p class="err" role="alert" aria-live="polite">{errorFor('host')}</p>
				{/if}
			</div>
		{/if}

		<label class="row" class:disabled={data.defaultOwner !== null}>
			<input
				type="radio"
				name="routingKind"
				value="default"
				bind:group={routingKind}
				disabled={data.defaultOwner !== null}
			/>
			<span class="row-main">This is the default site</span>
			<span class="row-sub">
				{#if data.defaultOwner !== null}
					Currently: <code>{data.defaultOwner}</code>.
				{:else}
					Catches every request that doesn't match a host or prefix.
				{/if}
			</span>
		</label>
		{#if routingKind === 'default' && data.defaultOwner === null}
			<div class="reveal">
				<p class="preview">Will serve at <code>{data.adminScheme}//{data.adminHost}/</code></p>
			</div>
		{/if}
		{#if errorFor('default')}
			<p class="err" role="alert" aria-live="polite">{errorFor('default')}</p>
		{/if}

		<label class="row">
			<input type="radio" name="routingKind" value="admin-only" bind:group={routingKind} />
			<span class="row-main">Admin-only for now</span>
			<span class="row-sub"
				>Loads into the admin but doesn't serve public traffic yet. Add <code>host</code> or
				<code>prefix</code>
				to <code>space.toml</code> later.</span
			>
		</label>
	</fieldset>

	{#if writeError === 'permission_denied'}
		<p class="amber-notice amber-notice--error" role="alert">
			{@render alertIcon()}
			<span>
				Amber doesn't have write access to your spaces directory. Fix the directory permissions and
				try again.
			</span>
		</p>
	{:else if writeError === 'write_failed'}
		<p class="amber-notice amber-notice--error" role="alert">
			{@render alertIcon()}
			<span>Couldn't create the space. Check the server logs for details.</span>
		</p>
	{:else if writeError === 'dir_already_exists'}
		<p class="amber-notice amber-notice--error" role="alert">
			{@render alertIcon()}
			<span>A directory with this slug already exists.</span>
		</p>
	{/if}

	<div class="actions">
		<button type="submit" class="amber-btn amber-btn--primary" disabled={submitting}>
			{submitting ? 'Creating…' : 'Create space'}
		</button>
		<a href={resolve('/admin')} class="amber-btn amber-btn--ghost">Cancel</a>
	</div>
</form>

<style>
	.amber-page-head__lede code,
	.row-sub code,
	.hint code,
	.amber-field__hint code,
	.preview code {
		font-size: 0.85em;
		background: var(--amber-surface-sunken);
		border: 1px solid var(--amber-rule);
		border-radius: 4px;
		padding: 0.05rem 0.3rem;
	}

	.new-space-form {
		max-width: 36rem;
		display: flex;
		flex-direction: column;
		gap: 1.25rem;
		margin-top: 0.25rem;
	}

	.field {
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	/* aria-invalid inputs read as in-error. */
	.amber-input[aria-invalid='true'] {
		border-color: var(--amber-danger);
	}

	.routing {
		border: 1px solid var(--amber-rule);
		border-radius: 10px;
		padding: 0.75rem 1rem 1rem;
	}
	.routing legend {
		padding: 0 0.25rem;
		font-weight: 600;
		color: var(--amber-ink);
	}

	/* Radio rows mirror the theme page's `.row`: bold ink main line, muted sub,
	   accent-tinted control. Two-column grid (no badge column here). */
	.row {
		display: grid;
		grid-template-columns: auto 1fr;
		grid-template-rows: auto auto;
		gap: 0.2rem 0.6rem;
		padding: 0.5rem 0;
		cursor: pointer;
		align-items: baseline;
	}
	.row.disabled {
		cursor: not-allowed;
		opacity: 0.6;
	}
	.row input[type='radio'] {
		grid-row: 1 / span 2;
		align-self: start;
		margin-top: 0.2rem;
		accent-color: var(--amber-accent);
	}
	.row-main {
		font-weight: 600;
		color: var(--amber-ink);
	}
	.row-sub {
		color: var(--amber-ink-muted);
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
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}
	.sublabel {
		font-weight: 600;
		font-size: 0.85rem;
		color: var(--amber-ink);
	}

	.hint {
		color: var(--amber-ink-muted);
		font-size: 0.88rem;
		margin: 0;
	}
	.err {
		color: var(--amber-danger);
		font-size: 0.88rem;
		margin: 0;
	}
	.preview {
		color: var(--amber-ink-muted);
		font-size: 0.88rem;
		margin: 0;
	}

	.actions {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		margin-top: 0.25rem;
	}
</style>
