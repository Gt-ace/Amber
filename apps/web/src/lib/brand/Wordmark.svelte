<script lang="ts">
	/*
	 * The Amber wordmark lockup: the glowing gem to the left of the lowercase
	 * word "amber" set in Fraunces. Spec: docs/brand/typography.md, "The wordmark".
	 *
	 *   - lowercase always (reads calmer / warmer than caps, on-brief)
	 *   - Fraunces at its display optical size with the warm SOFT axis open
	 *   - gem reads a touch taller than the word's cap-height, vertically centered
	 *
	 * Sizing scales off one knob, the `size` prop (the rendered font-size of the
	 * word); the gem and gap derive from it in `em`, so the lockup stays in
	 * proportion at any size. The gem is a small raster (~31 KB) rather than the
	 * 625 KB master SVG — this can render on every admin page, so weight matters.
	 *
	 * The word is real text (not baked into the image), so it's selectable,
	 * searchable, and recolors with the surface. The gem is decorative: its
	 * alt is empty and the accessible name comes from the text beside it.
	 */
	let { size = '1.5rem', tagline = '' }: { size?: string; tagline?: string } = $props();
</script>

<span class="brand-wordmark" style="--wordmark-size: {size}">
	<img class="brand-gem" src="/icon-192.png" alt="" width="192" height="192" />
	<span class="brand-word">amber</span>
	{#if tagline}<span class="brand-tagline">{tagline}</span>{/if}
</span>

<style>
	.brand-wordmark {
		display: inline-flex;
		align-items: center;
		/* gap ≈ 0.4× the gem width (gem ≈ 1.1em wide) → ~0.44em */
		gap: 0.42em;
		font-size: var(--wordmark-size);
		line-height: 1;
		white-space: nowrap;
	}

	.brand-gem {
		/* gem ≈ 1.1× the word's cap-height; Fraunces cap-height ≈ 0.7em, so
		   the gem box is ~1.1em tall and it reads a touch taller than the word.
		   A hair of negative margin pulls the optical center onto the baseline-
		   centered text (the gem's glow halo sits slightly high in its box). */
		height: 1.12em;
		width: auto;
		margin-top: 0.02em;
		flex: none;
	}

	.brand-word {
		font-family: var(--amber-font-display, 'Fraunces', Georgia, serif);
		font-weight: 580;
		font-variation-settings:
			'opsz' 144,
			'SOFT' 40,
			'WONK' 0;
		letter-spacing: -0.01em;
		color: var(--amber-ink, #2a2622);
		/* lowercase is the brand rule; enforce it even if a parent uppercases */
		text-transform: lowercase;
	}

	.brand-tagline {
		font-family: var(--amber-font-body, system-ui, sans-serif);
		font-weight: 500;
		font-size: 0.62em;
		letter-spacing: 0.02em;
		color: var(--amber-ink-muted, #655d4f);
		align-self: center;
	}
</style>
