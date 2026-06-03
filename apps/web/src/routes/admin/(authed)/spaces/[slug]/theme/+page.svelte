<script lang="ts">
	import type { PageData, ActionData } from './$types';
	import { resolve } from '$app/paths';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	// The radio that reflects the saved declaration: the declared theme if it's
	// a discovered row, else '' (use install default). A stale declaredTheme
	// has no row, so it falls back to ''.
	const discoveredNames = new Set(data.themes.map((t) => t.name));
	const initialValue =
		data.declaredTheme && discoveredNames.has(data.declaredTheme) ? data.declaredTheme : '';

	let selected = $state(initialValue);
	let submitting = $state(false);

	const themeError = form && 'themeError' in form ? form.themeError : null;
	const writeError = form && 'writeError' in form ? form.writeError : null;

	function renderingLine(): string {
		if (data.themeSource === 'space-toml') {
			return `Currently rendering: ${data.resolvedThemeName} — this space's space.toml.`;
		}
		if (data.staleThemeName) {
			return `Currently rendering: ${data.resolvedThemeName} — fell back after space.toml named "${data.staleThemeName}", which isn't a discovered theme.`;
		}
		return `Currently rendering: ${data.resolvedThemeName} — inherited install default.`;
	}
</script>

<svelte:head>
	<title>Theme — Amber admin</title>
</svelte:head>

<h1>Theme</h1>

{#if data.staleThemeName}
	<p class="warn" role="alert">
		<code>space.toml</code> names <code>{data.staleThemeName}</code>, which isn't a discovered
		theme. Pick one below and save to fix it.
	</p>
{/if}

{#if data.themes.length === 0}
	<p class="hint">
		No themes are discovered under <code>themes/</code>. Add a theme directory and restart to pick
		it here.
	</p>
{/if}

<form method="POST" onsubmit={() => (submitting = true)}>
	<ul class="theme-list">
		<li>
			<label class="row">
				<input type="radio" name="theme" value="" bind:group={selected} />
				<span class="row-main">Use install default</span>
				{#if data.declaredTheme === null}<span class="chip">Selected</span>{/if}
				<span class="row-sub">
					Falls through to the install-level theme set in <code>amber.toml</code>, then to
					<code>amber-default</code>.
				</span>
			</label>
		</li>
		{#each data.themes as t (t.name)}
			<li>
				<label class="row">
					<input type="radio" name="theme" value={t.name} bind:group={selected} />
					<span class="row-main">{t.name}</span>
					{#if data.declaredTheme === t.name}<span class="chip">Selected</span>{/if}
					{#if t.description}<span class="row-sub">{t.description}</span>{/if}
					{#if t.version || t.author}
						<span class="row-meta"
							>{t.version ?? ''}{t.version && t.author ? ' · ' : ''}{t.author ?? ''}</span
						>
					{/if}
				</label>
			</li>
		{/each}
	</ul>

	<p class="rendering">
		{renderingLine()}
		{#if data.publicUrl}
			<!-- publicUrl is the space's own external site URL, not an internal SvelteKit route. -->
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -->
			· <a href={data.publicUrl} target="_blank" rel="noopener">view your site ↗</a>
		{/if}
	</p>
	{#if !data.publicUrl}
		<p class="hint">
			This space has no public URL yet — set <code>host</code> or <code>prefix</code> in
			<code>space.toml</code> to make it reachable.
		</p>
	{/if}

	{#if themeError === 'theme_not_discovered'}
		<p class="form-err" role="alert">
			That isn't a discovered theme. The list above shows what's available.
		</p>
	{/if}
	{#if writeError === 'permission_denied'}
		<p class="form-err" role="alert">
			Amber doesn't have write access to this space's directory. Fix the directory permissions and
			try again.
		</p>
	{:else if writeError === 'write_failed'}
		<p class="form-err" role="alert">
			Couldn't update space.toml. Check the server logs for details.
		</p>
	{/if}

	<div class="actions">
		<button type="submit" disabled={submitting}>{submitting ? 'Saving…' : 'Save'}</button>
		<a href={resolve(`/admin/spaces/${data.slug}` as '/admin/spaces/[slug]')} class="cancel"
			>Cancel</a
		>
	</div>
</form>

<style>
	h1 {
		margin-bottom: 0.5rem;
	}
	.hint {
		color: #777;
		font-size: 0.9rem;
	}
	.warn {
		background: #fff7e6;
		border: 1px solid #f0d28a;
		padding: 0.6rem 0.8rem;
		border-radius: 4px;
		font-size: 0.9rem;
	}
	form {
		max-width: 40rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: 1rem;
	}
	.theme-list {
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px solid #ddd;
		border-radius: 4px;
	}
	.theme-list li + li {
		border-top: 1px solid #eee;
	}
	.row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.15rem 0.6rem;
		padding: 0.7rem 0.9rem;
		cursor: pointer;
		align-items: baseline;
	}
	.row input[type='radio'] {
		grid-row: 1 / span 3;
		align-self: start;
		margin-top: 0.25rem;
	}
	.row-main {
		font-weight: 600;
	}
	.chip {
		justify-self: end;
		grid-column: 3;
		grid-row: 1;
		font-size: 0.72rem;
		background: #e6f0ff;
		color: #1f3a8a;
		padding: 0.05rem 0.45rem;
		border-radius: 999px;
		align-self: center;
	}
	.row-sub {
		grid-column: 2 / 4;
		color: #666;
		font-size: 0.88rem;
	}
	.row-meta {
		grid-column: 2 / 4;
		color: #999;
		font-size: 0.8rem;
	}
	.rendering {
		color: #555;
		font-size: 0.9rem;
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
