# Amber — Brand Identity (current state)

Status as of 2026-06-01. The **core visual identity is designed and the assets exist**;
**implementation into the app is not yet done**. This file is the index + handoff for a
fresh chat that will do the implementation.

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
  `ui-monospace` (code). Both fonts OFL-licensed, self-hosted as `.woff2` (no CDN).
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

## Not done yet — implementation TODO (for the fresh chat)

Nothing below has been touched in the app code. Suggested order:

1. **Wire favicons + app icons into the app.** Copy the icon set into
   `apps/web/static/` and add the `<head>` links (favicon, apple-touch, manifest icons)
   to the root layout. Add/maintain a web-app manifest referencing `icon-192/512`.
   Set `theme-color` to `#FAF7F0` (light) / `#1A1714` (dark) to match the gem chrome.
2. **Self-host the fonts.** Add `Fraunces.woff2` + `HankenGrotesk.woff2` (Latin subset)
   under `apps/web/static/fonts/`, with `@font-face` (see `typography.md`). No CDN.
3. **Wordmark component / header.** Build the gem-+-"amber" lockup (Fraunces) for the
   admin UI header and/or marketing surface. Lockup spec in `typography.md`.
4. **(Optional) `amber-brand` theme.** A new theme under
   `spaces/<space>/themes/amber-brand/` that opts into Fraunces + Hanken Grotesk over
   the brand palette. The shipped `amber-default` / `amber-editorial` themes are
   **unchanged** — they keep system stacks per `docs/themes.md`.
5. **(Optional) og:image.** A 1200×630 share image using `amber-mark-1024.png` + wordmark.
6. **(Optional) Brand voice / usage guidelines** doc — clear space, misuse, do's & don'ts.

### Guardrails to respect during implementation

- **No font CDN** — ship `.woff2` locally (theme contract rule; brand layer follows it).
- **Don't modify the shipped themes' fonts** — brand faces are opt-in via a new theme.
- **Favicon/static work is app-surface**, not loader/render-path — keep it out of the
  public render path rules in `CLAUDE.md`.
- Amber is AGPL — both fonts are OFL (safe); keep `OFL.txt` with the font files.
