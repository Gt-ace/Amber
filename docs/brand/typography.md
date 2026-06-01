# Amber — Typography

Derived from the brief: *calm & sovereign, worn warmly.* All faces are free and
**self-hostable** (ship the `.woff2`, never link a font CDN — Amber's themes use
system stacks for exactly this reason; the brand layer follows the same rule).

This is the **brand layer** — the wordmark, marketing site, README, headings. It does
**not** change the shipped product themes (`amber-default` serif, `amber-editorial`
sans), which keep their system stacks per `docs/themes.md`. If a brand-styled theme is
ever wanted, it would be a new `amber-brand` theme that opts into these faces.

## The system

| Role | Face | Source |
| --- | --- | --- |
| **Display / wordmark / headings** | **Fraunces** (variable soft-serif) | Google Fonts |
| **Body / UI** | **Hanken Grotesk** (humanist sans) | Google Fonts |
| **Mono / code** | `ui-monospace` system stack | built-in |

A warm soft-serif over a calm humanist sans: editorial and premium up top, quiet and
readable underneath. Like Ghost / Bear — characterful without shouting.

## Fraunces — settings

Fraunces is variable; the axes carry the warmth. Recommended:

- **Wordmark / big display:** `opsz` 144 (max optical size), `wght` 560–600,
  `SOFT` 40 (rounds the terminals — the "warm" axis), `WONK` 0 (keep it refined,
  not quirky). Slight negative tracking, ~`-0.01em`.
- **Headings (h1–h3):** `opsz` auto/large, `wght` 600, `SOFT` 30, `WONK` 0.
- **Pull-quotes / accents:** italic is lovely here; use sparingly.

```css
--amber-font-display: 'Fraunces', Georgia, 'Times New Roman', serif;
/* wordmark/heading element */
.brand-wordmark {
  font-family: var(--amber-font-display);
  font-weight: 580;
  font-variation-settings: 'opsz' 144, 'SOFT' 40, 'WONK' 0;
  letter-spacing: -0.01em;
  color: #2A2622;            /* ink; on dark use #E8E0D2 */
}
```

## Hanken Grotesk — body / UI

```css
--amber-font-body: 'Hanken Grotesk', system-ui, -apple-system, 'Segoe UI', sans-serif;
```
Weights to ship: 400 (body), 500 (emphasis/UI), 600 (subheads). Line-height ~1.6 for
body, matching the theme's `--amber-leading-body`.

## The wordmark

Lowercase **"amber"** in Fraunces (settings above), deep ink, locked beside the gem:

- Gem on the **left**, wordmark vertically centered to it.
- Gem height ≈ 1.1× the wordmark cap-height (gem reads a touch taller).
- Gap between gem and word ≈ 0.4× the gem width.
- Light bg: wordmark `#2A2622`. Dark bg: wordmark `#E8E0D2`. Gem unchanged (it glows).
- Lowercase always — it reads calmer and warmer than caps, on-brief.

## Type scale (brand / marketing)

A simple modular scale (≈1.25). The product themes keep their own scales; this is for
brand surfaces.

| Step | Size | Use |
| --- | --- | --- |
| Display | 3.0rem | Hero wordmark / page title |
| H1 | 2.25rem | Section title |
| H2 | 1.6rem | Subsection |
| H3 | 1.25rem | Minor heading |
| Body | 1.0625rem | Prose |
| Small | 0.85rem | Captions, meta |

## Self-hosting (the no-CDN rule)

1. Download the **variable** `.woff2` for each face:
   - Google Fonts → *Get font* → *Download* (gives static cuts), **or**
   - **google-webfonts-helper** (`gwfh.mranftl.com`) — pick *woff2*, grab the
     variable file + ready-made `@font-face` CSS.
2. Drop the `.woff2` in your assets and declare it locally:

```css
@font-face {
  font-family: 'Fraunces';
  src: url('/fonts/Fraunces.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-display: swap;
}
@font-face {
  font-family: 'Hanken Grotesk';
  src: url('/fonts/HankenGrotesk.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-display: swap;
}
```

3. Subset to Latin (and only the weights you use) to keep it light — gwfh and
   `fonttools`/`glyphhanger` can subset. `font-display: swap` avoids a blank-text flash.

## Licensing

Both are **SIL Open Font License (OFL)** — free for commercial use, redistribution,
and bundling/self-hosting. Safe to ship with an AGPL project; keep the `OFL.txt`
alongside the font files.
