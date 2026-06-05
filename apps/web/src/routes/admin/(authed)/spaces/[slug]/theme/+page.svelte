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
			return `Currently rendering: ${data.resolvedThemeName}, from this space's space.toml.`;
		}
		if (data.staleThemeName) {
			return `Currently rendering: ${data.resolvedThemeName}. Fell back after space.toml named "${data.staleThemeName}", which isn't a discovered theme.`;
		}
		return `Currently rendering: ${data.resolvedThemeName}, inherited install default.`;
	}
</script>

<svelte:head>
	<title>Theme · Amber admin</title>
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
		<h1>Theme</h1>
		<p class="amber-page-head__lede">
			Choose how this space looks. Themes come from Amber's built-in shared set plus any in this
			space's <code>themes/</code> directory; your pick is saved to <code>space.toml</code> and hot-reloads
			with no restart.
		</p>
	</div>
</header>

{#if data.staleThemeName}
	<p class="amber-notice amber-notice--warn" role="alert">
		{@render alertIcon()}
		<span>
			<code>space.toml</code> names <code>{data.staleThemeName}</code>, which isn't a discovered
			theme. Pick one below and save to fix it.
		</span>
	</p>
{/if}

{#if data.themes.length === 0}
	<p class="hint">
		No themes are available. Add a theme directory under this space's <code>themes/</code> and restart.
	</p>
{/if}

<form method="POST" onsubmit={() => (submitting = true)}>
	<ul class="theme-list">
		<li>
			<label class="row">
				<input type="radio" name="theme" value="" bind:group={selected} />
				<span class="row-main">Use install default</span>
				{#if data.declaredTheme === null}<span class="amber-badge amber-badge--accent"
						>Selected</span
					>{/if}
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
					<span class="row-title">
						<span class="row-main">{t.name}</span>
						<span class="source-tag">{t.source === 'shared' ? 'shared' : 'this space'}</span>
					</span>
					{#if data.declaredTheme === t.name}<span class="amber-badge amber-badge--accent"
							>Selected</span
						>{/if}
					{#if t.description}<span class="row-sub">{t.description}</span>{/if}
					{#if t.version || t.author}
						<span class="row-meta"
							>{t.version ?? ''}{t.version && t.author ? ' · ' : ''}{t.author ?? ''}</span
						>
					{/if}
					<span class="row-preview" class:row-preview--active={selected === t.name}>
						<!-- Live mini-render of the theme. Sandboxed (no scripts, opaque
						     origin) and pointer-events:none so clicks fall through to the
						     enclosing label and select the theme. -->
						<iframe
							class="theme-preview"
							title="Preview of {t.name}"
							srcdoc={t.previewHtml}
							loading="lazy"
							tabindex="-1"
							scrolling="no"
							sandbox=""
						></iframe>
					</span>
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
			This space has no public URL yet. Set <code>host</code> or <code>prefix</code> in
			<code>space.toml</code> to make it reachable.
		</p>
	{/if}

	{#if themeError === 'theme_not_discovered'}
		<p class="amber-notice amber-notice--error" role="alert">
			{@render alertIcon()}
			<span>That isn't a discovered theme. The list above shows what's available.</span>
		</p>
	{/if}
	{#if writeError === 'permission_denied'}
		<p class="amber-notice amber-notice--error" role="alert">
			{@render alertIcon()}
			<span>
				Amber doesn't have write access to this space's directory. Fix the directory permissions and
				try again.
			</span>
		</p>
	{:else if writeError === 'write_failed'}
		<p class="amber-notice amber-notice--error" role="alert">
			{@render alertIcon()}
			<span>Couldn't update space.toml. Check the server logs for details.</span>
		</p>
	{/if}

	<div class="actions">
		<button type="submit" class="amber-btn amber-btn--primary" disabled={submitting}
			>{submitting ? 'Saving…' : 'Save'}</button
		>
		<a
			href={resolve(`/admin/spaces/${data.slug}` as '/admin/spaces/[slug]')}
			class="amber-btn amber-btn--ghost">Cancel</a
		>
	</div>
</form>

<style>
	.amber-page-head__lede code,
	.row-sub code,
	.hint code,
	.amber-notice code {
		font-size: 0.85em;
		background: var(--amber-surface-sunken);
		border: 1px solid var(--amber-rule);
		border-radius: 4px;
		padding: 0.05rem 0.3rem;
	}

	.hint {
		color: var(--amber-ink-muted);
		font-size: 0.9rem;
	}

	form {
		max-width: 42rem;
		display: flex;
		flex-direction: column;
		gap: 1rem;
		margin-top: 0.25rem;
	}

	/* Theme rows: a bordered list mirroring the users page's `.user-list`. */
	.theme-list {
		list-style: none;
		padding: 0;
		margin: 0;
		border: 1px solid var(--amber-rule);
		border-radius: 10px;
		overflow: hidden;
	}
	.theme-list li + li {
		border-top: 1px solid var(--amber-rule);
	}
	.row {
		display: grid;
		grid-template-columns: auto 1fr auto;
		gap: 0.15rem 0.7rem;
		padding: 0.85rem 1.1rem;
		cursor: pointer;
		align-items: baseline;
	}
	.row input[type='radio'] {
		grid-row: 1 / span 3;
		align-self: start;
		margin-top: 0.2rem;
		accent-color: var(--amber-accent);
	}
	.row-title {
		display: flex;
		align-items: baseline;
		gap: 0.45rem;
		flex-wrap: wrap;
	}
	.row-main {
		font-weight: 600;
		color: var(--amber-ink);
	}
	.source-tag {
		font-size: 0.7rem;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: var(--amber-ink-muted);
		background: var(--amber-surface-sunken);
		border: 1px solid var(--amber-rule);
		border-radius: 3px;
		padding: 0.05rem 0.35rem;
		line-height: 1.4;
	}
	.row .amber-badge {
		justify-self: end;
		grid-column: 3;
		grid-row: 1;
	}
	.row-sub {
		grid-column: 2 / 4;
		color: var(--amber-ink-muted);
		font-size: 0.88rem;
	}
	.row-meta {
		grid-column: 2 / 4;
		color: var(--amber-ink-muted);
		font-size: 0.8rem;
	}

	/* Live theme preview. The iframe renders at a desktop-ish width and is
	   scaled down to a thumbnail; the wrapper clips the result to a fixed
	   height. transform-origin top-left keeps the masthead in view. */
	.row-preview {
		grid-column: 1 / 4;
		margin-top: 0.7rem;
		height: 200px;
		overflow: hidden;
		border: 1px solid var(--amber-rule);
		border-radius: 8px;
		background: var(--amber-surface-sunken);
		/* A faint inner shadow reads as a recessed "screen". */
		box-shadow: inset 0 1px 3px rgb(0 0 0 / 0.06);
		transition: border-color 0.15s ease;
	}
	.row-preview--active {
		border-color: var(--amber-accent);
	}
	.theme-preview {
		width: 1280px;
		height: 800px;
		border: 0;
		display: block;
		transform: scale(0.5);
		transform-origin: top left;
		pointer-events: none;
		background: #fff;
	}
	@media (max-width: 640px) {
		.row-preview {
			height: 150px;
		}
		.theme-preview {
			transform: scale(0.36);
		}
	}

	.rendering {
		color: var(--amber-ink-muted);
		font-size: 0.9rem;
		margin: 0;
	}
	.rendering a {
		color: var(--amber-accent);
	}
	.rendering a:hover {
		color: var(--amber-accent-hover);
	}

	.actions {
		display: flex;
		gap: 0.8rem;
		align-items: center;
		margin-top: 0.25rem;
	}
</style>
