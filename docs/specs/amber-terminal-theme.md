# Spec: `amber-terminal` — a fourth shared theme

Status: approved (design) · Date: 2026-06-05 · Branch: `theme/amber-terminal`

## Summary

Add `amber-terminal`, a fourth app-bundled **shared** theme: a dark-first,
one-voice **monospace** reading theme with "tactical telemetry" framing —
hairline rules and `▌` / `[ ]` / `//` markers in amber phosphor on warm
charcoal. It targets Amber's core audience (people who self-host) and fills
two gaps in the current lineup at once: there is no monospace/technical theme,
and the only dark option today is `amber-brand`'s opt-in toggle.

It ships alongside `amber-default`, `amber-editorial`, and `amber-brand`, is
available to every space with no per-space copy, and is selected like any
other shared theme via `space.toml` / `amber.toml` (`theme = "amber-terminal"`).

This is a pure theme addition. It introduces **no new dependencies**, **no new
`--amber-*` tokens**, **no `theme.js`**, and **no code-path changes** to the
loader, render path, or asset route. The only non-theme files it touches are
the hardcoded lists that enumerate the shared theme set (see "The fourth shared theme ripple" below)
and the theme documentation.

## Goals

- A complete, contract-conformant theme directory at
  `apps/web/themes/amber-terminal/`.
- Distinct identity: monospace one-voice, dark-first, amber-on-charcoal,
  telemetry framing — visibly different from the three existing themes.
- Dark **and** light, both composed only from the 8 color tokens.
- Bundled into the production image and pickable from the subsystem-6
  theme-picker UI exactly like the other shared themes — no special-casing.

## Non-goals

- No `theme.js`, no light/dark toggle (OS-following only). A toggle could be
  added later the way `amber-brand` does it; out of scope here.
- No self-hosted `@font-face`. System monospace stack only.
- No new `--amber-*` contract tokens. If the layout needs a theme-local
  variable, it uses a `--term-*` prefix (the `--ed-rail-width` precedent).
- No changes to template variables, the template runtime, the loader, the
  asset route, or any render logic.

## The theme directory

Standard file set (per `docs/themes.md` "File contract"):

```
apps/web/themes/amber-terminal/
  theme.toml          metadata + [theme_color] (light & dark) + [footer]?
  theme.css           :root dark base + light remap + styles
  chrome.html         byte-identical to amber-default's chrome.html
  page.html           contract variables only (no invented fields)
  error.html          contract structure, telemetry-styled
  partials/
    index.html        auto-index as a bordered telemetry table
```

No `theme.js`, no `fonts/`.

### `theme.toml`

```toml
name = "amber-terminal"
version = "0.1.0"
author = "Amber"
description = "Dark-first monospace telemetry theme for self-hosters."

[theme_color]
light = "#f3f1ea"   # mirrors light-remap --amber-bg
dark  = "#0e0d0b"   # mirrors base --amber-bg
```

`[footer]` is optional and omitted by default (spaces add their own via the
theme contract only if the theme hardcodes one — it does not).

### `theme.css` — tokens

All **28** `--amber-*` tokens are defined (contract completeness), even where
a value coincides with another theme's. One voice: `--amber-font-body`,
`--amber-font-heading`, `--amber-font-ui`, and `--amber-font-mono` all resolve
to the same system monospace stack:

```
ui-monospace, "SF Mono", "JetBrains Mono", "IBM Plex Mono", Menlo, Consolas, monospace
```

Indicative base (dark) color tokens — final values tuned during build:

| Token | Value (dark base) |
| --- | --- |
| `--amber-bg` | `#0e0d0b` warm charcoal |
| `--amber-ink` | `#e9e2d2` |
| `--amber-ink-muted` | `#8a8170` |
| `--amber-accent` | `#e0a94a` amber phosphor |
| `--amber-accent-hover` | `#f3c873` |
| `--amber-rule` | `#2a2620` |
| `--amber-surface-sunken` | `#181612` |
| `--amber-selection-bg` | `rgba(224, 169, 74, 0.22)` |

Shape: `--amber-radius: 0` (hard edges). The remaining type/space/motion
tokens follow the monospace reading layout (centered single column, ~40rem
measure); exact values are a build detail, not a contract concern.

### `theme.css` — dark-first, contract-honest

This is the one deliberate, documented deviation from how the two reference
themes are written, and it changes **no code path**:

- The `:root` base block holds the **dark** phosphor palette (the theme's
  identity).
- A `@media (prefers-color-scheme: light)` block remaps the **8 color tokens**
  to a "paper terminal" (carbon ink on warm paper) and **nothing else**.

The binding rule in `themes.md` is: *"Dark mode is a `@media` block that
remaps the eight color tokens, and nothing else. Type, spacing, layout,
motion — all mode-agnostic. This is the contract."* That requirement is
honored exactly; only which mode lives in `:root` differs. The CSS is served
verbatim and the browser resolves the media query, so SSR, the render path,
and `[theme_color]` (whose keys are mode-named, not base-relative) are all
unaffected.

**Plan obligation (dark-mode doc clarification):** add a one-line clarification to `docs/themes.md`'s
"Dark mode" section stating that base-mode is the theme's identity choice and
the binding requirement is the 8-token remap — so the doc's wording and the
shipped theme do not silently disagree (per CLAUDE.md: fix the doc, don't
paper over the gap).

### Templates

- **`chrome.html`** — byte-identical to `amber-default`'s. The `▌` title
  prefix and `[ ]` nav framing are done entirely in CSS (`::before`/`::after`),
  so the markup stays shared; layout is a stylesheet decision.
- **`page.html`** — uses only the exposed variables (`is_draft`, `is_home`,
  `has_header`, `title`, `date_iso`, `date_display`, `html`, `index_html`).
  **No "eyebrow"/"LOG ENTRY" field** — that was mockup flavor and there is no
  contract variable for it; stamping it on every page (e.g. an About page)
  would be wrong. All telemetry framing is CSS on real data (`title`, `date`,
  `h2` via `// ` markers).
- **`error.html`** — keeps the contract structure (`{{#is_404}}` with the
  `{{#has_body}}`/`{{^has_body}}` fork, plus `{{^is_404}}`), styled in the
  telemetry idiom.
- **`partials/index.html`** — `auto_index` list rendered as a bordered
  telemetry table (link + right-aligned date), using the standard
  `index_entries` shape (`href`, `title`, `date`, `updated`).

### Motion

Exactly **one** one-off entrance, guarded by
`@media (prefers-reduced-motion: no-preference)` — matching the existing
themes' "a single one-off entrance and nothing else" convention. No persistent
blinking cursor or typewriter loop (continuous motion breaks the convention).

## The fourth shared theme ripple — explicit checklist

Adding a theme directory is not enough if any place hardcodes the set of three.
The plan **must** resolve each of these; they are the parts that ship broken if
missed.

1. **Find every hardcoded list.** Run
   `grep -rn "amber-editorial" apps/ docs/ Dockerfile* compose*` and the same
   for `amber-brand`. Anywhere all three names co-occur is a hardcoded list — a
   Dockerfile `COPY`, a constant array, a test asserting the shared set, a docs
   sentence saying "three built-in shared themes." Add the 4th to each.
2. **Verify the image bundles themes by glob, not a named copy.** The design
   assumes the whole `themes/` dir is carried into `build/themes/`. Confirm it.
   If the Dockerfile copies an enumerated list of theme names, `amber-terminal`
   is invisible in production (and a local `bun --bun run dev` won't catch it,
   since dev resolves `apps/web/themes/` directly).
3. **Verify the subsystem-6 theme-picker enumerates dynamically.** The picker
   is expected to list the effective theme set (shared ∪ space `themes/`) at
   runtime, so the new theme appears automatically. Confirm there is no
   snapshot test or hardcoded option list that pins it to the current three.
4. **Update `docs/themes.md`.** The "three built-in shared themes" count
   appears in several sentences; each becomes four. Add `amber-terminal` to the
   theme list. (Plus the dark-mode doc clarification from the `theme.css`
   section above.)

## Discovery & lifecycle (no new behavior)

- Theme discovery runs at cold start; adding a new theme directory requires a
  server restart (existing, documented behavior).
- Once discovered, editing files **within** the theme dir is picked up per
  request (templates read from disk; CSS served as an asset) — also existing
  behavior.
- Selection and resolution are unchanged: `space.toml` → `amber.toml` →
  `amber-default` → built-in floor.

## Testing & verification

- **Discovery/resolution:** if a test asserts the shared theme set or its
  count, update it to include `amber-terminal` (found via the ripple-checklist
  grep).
- **Contract conformance (manual / mockup-derived):** the theme is already
  prototyped (see the brainstorming mockups); the real theme reproduces it
  within the file contract. Render the example space under `amber-terminal` in
  both OS color schemes and confirm: dark base and light remap both read well;
  only the 8 color tokens differ between modes; nav, article header, prose,
  code block, blockquote, lists, auto-index, and the 404/error page all render;
  no literal colors leak outside the media blocks.
- **No-JS:** page is complete with JavaScript disabled (trivially true — no
  `theme.js`).
- **Build:** after confirming the bundling mechanism (ripple-checklist item 2),
  build the image
  (or simulate the copy) and confirm `amber-terminal` lands in `build/themes/`.

## Acceptance criteria

- [ ] `apps/web/themes/amber-terminal/` exists with all required files, passes
      discovery, and renders the example space.
- [ ] Dark base + light remap, with only the 8 color tokens differing between
      modes; no new `--amber-*` tokens; no literal colors outside the media
      blocks.
- [ ] `chrome.html` byte-identical to `amber-default`; `page.html` uses only
      contract variables.
- [ ] Every hardcoded "three themes" site (tests, docs, any Dockerfile/compose
      list) updated to four; build bundles the theme; theme-picker lists it.
- [ ] `docs/themes.md` updated: counts → four, theme listed, dark-mode
      base-choice clarification added.
- [ ] No new dependencies; no `theme.js`; no `app.html` change; no loader /
      render / asset-route change.
