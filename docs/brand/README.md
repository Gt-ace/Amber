# Amber — Brand Identity (current state)

Status as of 2026-06-01. The **core visual identity is designed**, the assets exist, and
the **core implementation into the app has landed** — favicons/app icons/manifest, the
self-hosted brand fonts (admin surface only), and the gem-+-wordmark lockup in the admin
header. The remaining items (an opt-in `amber-brand` theme, an og:image, a voice doc)
are optional follow-ups, not blockers. This file is the index + handoff.

## What's done ✅

| Piece | File(s) | Decision in one line |
| --- | --- | --- |
| **Brief** | [`brief.md`](brief.md) | Calm & sovereign, worn warmly; optimize for non-technical creators first. |
| **Palette** | [`palette.md`](palette.md), [`palette.html`](palette.html) | Warm-amber system, signature **#C6871F**, aligned to the existing theme tokens. |
| **Logo** | [`logo/`](logo/) | Faceted, glowing amber gem. Faithful production **SVG** + favicon/PWA icon set. |
| **Typography** | [`typography.md`](typography.md) | **Fraunces** (display/wordmark) + **Hanken Grotesk** (body), both self-hostable. |
| **Logo prompts** | [`logo-prompts.md`](logo-prompts.md) | Archived Gemini "Nano Banana" prompts to regenerate the mark. |

### Key values (quick reference)

- **Signature color:** `#C6871F` (amber-500). Light-mode link/text amber: `#9A6314`.
  Dark-mode accent: `#D9A441`. On amber fills use ink `#2A2622`, never white.
- **Neutrals (light):** bg `#FAF7F0`, ink `#2A2622`, muted `#655D4F`, rule `#E4DCC9`.
- **Neutrals (dark):** bg `#1A1714`, ink `#E8E0D2`, muted `#9A8F7D`, rule `#332E27`.
- **Fonts:** Fraunces (display, variable, `SOFT 40` for warmth), Hanke Grotesk (body),
  Hanken Grotesk (body), `ui-monospace` (code). Both fonts OFL-licensed, self-hosted
  as `.woff2` (no CDN).
- **Wordmark:** lowercase **"amber"** in Fraunces, gem to the left.

## Logo assets (in [`logo/`](logo/))

| File | Use |
| --- | --- |
| `amber-mark.svg` | **Production master.** Faithful color-trace (VTracer), ~625 KB, scales to any size. |
| `amber-mark-1024.png` | Raster for README / social / og-image. |
| `favicon.ico` | Multi-res browser favicon (16/32/48). |
| `apple-touch-icon-180.png` | iOS home-screen. |
| `icon-512.png`, `icon-192.png` | PWA manifest icons. |
| `icon-16/32/48.png` | Standalone favicon sizes. |

> Large source/working PNGs (raw Gemini render, cleaned master) were **deleted and
> gitignored** — the SVG is the master and regenerates any raster via
> `npx @resvg/resvg-js-cli logo/amber-mark.svg out.png --fit-width <N>`. See
> [`logo/README.md`](logo/README.md) for how the SVG was produced (and how to re-trace).

## Tooling notes (for regeneration)

- **Logo ideation:** Gemini app / "Nano Banana Pro" (Google AI Pro). Raster only.
- **PNG → SVG:** **VTracer** (`@neplex/vectorizer` node binding, or the free visioncortex
  web demo) — the only free tracer that handles gradients well. Avoid potrace-based
  converters (FreeConvert, Adobe Express, svgco.de) for this gradient image.
- **SVG → PNG (verify/rasterize):** `npx @resvg/resvg-js-cli` (`--fit-width N`).
- **Palette explore:** Huemint / Coolors (free). **Contrast:** WebAIM checker.
- **Fonts:** google-webfonts-helper (`gwfh.mranftl.com`) for variable `.woff2` + subsetting.

## Implementation status

Items 1–3 are **done** (landed 2026-06-01). Where the implementation chose a value the
brief left open, it's noted inline.

1. **Favicons + app icons + manifest — done.** Icon set copied to `apps/web/static/`;
   install-wide `<head>` links live in `apps/web/src/app.html` (not a layout — they're
   the same for every space and surface): `favicon.ico` (multi-res 16/32/48),
   `apple-touch-icon`, `site.webmanifest` (referencing `icon-192/512`), and light/dark
   `theme-color` (`#faf7f0` / `#1a1714`). A public space's active theme can still
   override `theme-color` via its own `+layout.svelte` (SvelteKit injects it after
   `app.html`, so it wins on matching media).
   - *Decision:* **no SVG favicon.** The 625 KB gradient-traced master would be fetched
     as the icon on every page (browsers prefer `image/svg+xml`) and renders muddy at
     16–32px. `favicon.ico` covers favicon duty; a crisp SVG favicon would need a small
     hand-built silhouette, not the master.
   - *Decision:* manifest icons are `"any"` only — no `maskable` entry, because the gem
     has no safe-zone padding and Android's mask would clip it.
2. **Self-hosted fonts — done (admin surface only).** `Fraunces.woff2` (the **full-axis**
   variable cut — `opsz` / `wght` / `SOFT` / `WONK`, *not* a weight-only subset, which
   would silently flatten the wordmark) and `HankenGrotesk.woff2`, Latin-subset, under
   `apps/web/static/fonts/` with each face's `OFL.txt` beside it. `@font-face` + the
   warm-amber tokens live in `apps/web/src/lib/brand/brand.css`, imported by the **admin
   layout only** — the public render path stays on system stacks per `docs/themes.md`.
3. **Wordmark component / header — done.** `apps/web/src/lib/brand/Wordmark.svelte` is the
   gem-+-lowercase-"amber" lockup (Fraunces `opsz 144 / SOFT 40 / WONK 0`, −0.01em
   tracking, ink-aware), used in the admin header (`routes/admin/+layout.svelte`). The
   gem is a ~31 KB raster (`icon-192.png`), not the master SVG, since it can render on
   every admin page. The admin surface also adopts Hanken (body) + Fraunces (headings)
   over the brand neutrals, with dark-mode.

### Optional follow-ups (not built)

4. **(Optional) `amber-brand` theme.** A new theme under
   `spaces/<space>/themes/amber-brand/` that opts into Fraunces + Hanken Grotesk over
   the brand palette. The shipped `amber-default` / `amber-editorial` themes are
   **unchanged** — they keep system stacks per `docs/themes.md`. Note: a public theme
   that self-hosts fonts is a *new* pattern for the theme contract (themes.md mandates
   system stacks), so this is a proper spec→build cycle, not a drop-in.
5. **(Optional) og:image.** A 1200×630 share image using `amber-mark-1024.png` + wordmark,
   plus the per-space `og:*` wiring to reference it.
6. **(Optional) Brand voice / usage guidelines** doc — clear space, misuse, do's & don'ts.

### Guardrails to respect during implementation

- **No font CDN** — ship `.woff2` locally (theme contract rule; brand layer follows it).
- **Don't modify the shipped themes' fonts** — brand faces are opt-in via a new theme.
- **Favicon/static work is app-surface**, not loader/render-path — keep it out of the
  public render path rules in `CLAUDE.md`.
- Amber is AGPL — both fonts are OFL (safe); keep `OFL.txt` with the font files.
