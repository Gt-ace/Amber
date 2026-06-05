# Spec: `amber-press` and `amber-dusk` — two new shared themes

Status: approved (design) · Date: 2026-06-05 · Branch: `theme/amber-terminal`

## Summary

Add two app-bundled **shared** themes, taking the built-in set from three to
five:

- **`amber-press`** — a brutalist Swiss-print theme. Light-first newsprint
  substrate, heavy grotesque display headings, serif body, monospace
  metadata, a burnt-amber hazard accent, and a rule-heavy structural grid.
  Loud and editorial — the most expressive theme in the set.
- **`amber-dusk`** — a soft, warm, rounded **dark-first** reading theme.
  One-voice humanist sans, gentle amber accent, rounded surfaces, generous
  spacing. Cozy — for journaling and long-form reading.

Both ship alongside `amber-default`, `amber-editorial`, and `amber-brand`, are
available to every space with no per-space copy, and are selected like any
other shared theme via `space.toml` / `amber.toml`
(`theme = "amber-press"` / `theme = "amber-dusk"`).

(An earlier draft of this spec covered a single `amber-terminal` theme; the
direction was changed to these two during brainstorming. `amber-terminal`
remains a viable future addition but is out of scope here.)

These are pure theme additions: **no new dependencies**, **no new `--amber-*`
tokens**, **no `theme.js`**, and **no code-path changes** to the loader,
render path, or asset route. The only non-theme files touched are the
hardcoded lists that enumerate the shared theme set (see "The new shared
themes ripple") and the theme documentation.

## Goals

- Two complete, contract-conformant theme directories under
  `apps/web/themes/`.
- Distinct identities, visibly different from each other and from the three
  existing themes.
- Each ships dark **and** light, composed only from the 8 color tokens.
- Both bundled into the production image and pickable from the subsystem-6
  theme-picker UI exactly like the other shared themes — no special-casing.

## Non-goals

- No `theme.js`, no light/dark toggle (OS-following only).
- No self-hosted `@font-face`. System font stacks only — including
  `amber-press`'s display headings, which use a heavy system grotesque stack
  rather than a self-hosted display face. (Self-hosting a display face such as
  Archivo Black is a possible future enhancement for `amber-press`, explicitly
  deferred.)
- No new `--amber-*` contract tokens. Where a theme needs a variable outside
  the 28-token contract, it uses a theme-local prefix (`--press-*` /
  `--dusk-*`), following the `--ed-rail-width` precedent.
- No changes to template variables, the template runtime, the loader, the
  asset route, or any render logic.
- `amber-terminal` (the dark monospace direction) is not built here.

## Shared contract discipline (applies to both themes)

Both themes obey the same rules, drawn from `docs/themes.md`:

- **Standard file set.** `theme.toml`, `theme.css`, `chrome.html`,
  `page.html`, `error.html`, `partials/index.html`. No `theme.js`, no
  `fonts/`.
- **`chrome.html` byte-identical to `amber-default`'s.** All distinctive
  chrome treatment (press's masthead rules, dusk's floating pill) is a
  stylesheet decision; the markup stays shared. Decorative glyphs are
  `::before`/`::after` in CSS.
- **`page.html` uses only the exposed variables** (`is_draft`, `is_home`,
  `has_header`, `title`, `date_iso`, `date_display`, `html`, `index_html`).
  **No invented fields** — the mockups' "Dispatch No. 014" kicker
  (press) and "Writing" eyebrow (dusk) were flavor with no contract variable
  behind them and are dropped. All such framing becomes CSS on real data
  (`title`, `date`, `h2`), or is omitted.
- **`error.html` keeps the contract structure** (`{{#is_404}}` with the
  `{{#has_body}}`/`{{^has_body}}` fork, plus `{{^is_404}}`), themed
  appropriately.
- **`partials/index.html`** renders the `auto_index` list from the standard
  `index_entries` shape (`href`, `title`, `date`, `updated`).
- **All 28 `--amber-*` tokens defined** for contract completeness, even where
  a value coincides with another theme's. No new `--amber-*` names.
- **Dark + light via the 8-token rule.** Exactly the 8 color tokens move
  between modes; type, spacing, layout, and motion are mode-agnostic.
- **Exactly one one-off entrance animation**, guarded by
  `@media (prefers-reduced-motion: no-preference)` — matching the existing
  themes' "a single one-off entrance and nothing else" convention. No
  persistent/looping motion.

## `amber-press` — design

**Identity.** Brutalist Swiss print: newsprint paper, carbon ink, heavy
grotesque headlines, and a single burnt-amber hazard accent
(`#c2480f`-ish — a deliberate bridge between Amber's accent family and
aviation-hazard red). Rule-heavy grid, hard edges (`--amber-radius: 0`),
oversized display type.

**Light-first.** `:root` base holds the light newsprint palette (this matches
the documented "light is base" convention; no inversion needed). A
`@media (prefers-color-scheme: dark)` block remaps the 8 color tokens to a
carbon-substrate inversion (dark paper, light ink, the same hazard accent).

**Typography — multi-voice.**
- `--amber-font-heading`: a heavy system grotesque stack
  (`"Helvetica Neue", "Arial Narrow", system-ui, sans-serif`) used at large
  display sizes with tight negative tracking and compressed leading, uppercase.
- `--amber-font-body`: a serif stack (`"Iowan Old Style", Palatino, Georgia,
  serif`) for readable prose.
- `--amber-font-ui` / `--amber-font-mono`: a system monospace stack for
  metadata (kicker rules, dates, footer, the auto-index numerals).

**Signature treatments (all pure CSS on real data):**
- Masthead header with a thick top/bottom rule; nav items underline-on-hover
  in the accent.
- Oversized uppercase article title via `clamp()`.
- Drop-cap on the first body paragraph (`::first-letter`), in the accent.
- `h2` section headings with a heavy top rule.
- Blockquote rendered as a large grotesque pull-quote.
- Code blocks: inverted (ink background, paper text), hard-edged.
- Auto-index as a numbered index card (`decimal-leading-zero` CSS counter),
  no markup change beyond the standard list.

**Theme-local tokens:** `--press-*` prefix if any layout variable is needed
beyond the 28-token contract.

## `amber-dusk` — design

**Identity.** Soft, warm, cozy reading. Rounded surfaces
(`--amber-radius: 16px`), generous spacing, a gentle amber accent
(`#e0a06a`-ish) on a warm plum-charcoal background. One calm voice.

**Dark-first, contract-honest.** `:root` base holds the **dark** dusk palette
(the theme's identity); a `@media (prefers-color-scheme: light)` block remaps
the 8 color tokens to a soft light variant and nothing else. The binding rule
in `themes.md` is *"the `@media` block remaps the eight color tokens, and
nothing else … This is the contract."* — honored exactly; only which mode
lives in `:root` differs. The CSS is served verbatim and the browser resolves
the media query, so SSR, the render path, and `[theme_color]` (whose keys are
mode-named) are all unaffected.

**Plan obligation (dark-mode doc clarification):** add a one-line
clarification to `docs/themes.md`'s "Dark mode" section stating that base-mode
is the theme's identity choice and the binding requirement is the 8-token
remap — so the doc's wording and the shipped theme do not silently disagree
(per CLAUDE.md: fix the doc, don't paper over the gap). `amber-dusk` is the
first dark-base theme.

**Typography — one voice.** `--amber-font-body` = `--amber-font-heading` =
`--amber-font-ui` = a humanist sans stack (`"Hanken Grotesk", "Avenir Next",
"Segoe UI", system-ui, sans-serif`); `--amber-font-mono` is a system
monospace stack for code only.

**Signature treatments:**
- Header as a floating rounded "pill" (CSS on the shared chrome markup); nav
  items are pill-shaped hover targets.
- Rounded sunken surfaces for code and a card-style blockquote.
- Auto-index as soft raised cards with a gentle `translateY` hover (transform
  only).

**Theme-local tokens:** the mockup's `--amber-surface-raised` is **not** a
contract token; it is renamed `--dusk-surface-raised` (theme-local prefix) to
avoid inventing a new `--amber-*` name.

## The new shared themes ripple — explicit checklist

Adding two theme directories is not enough if any place hardcodes the set of
three. The plan **must** resolve each of these for **both** new themes; they
are the parts that ship broken if missed.

1. **Find every hardcoded list.** Run
   `grep -rn "amber-editorial" apps/ docs/ Dockerfile* compose*` and the same
   for `amber-brand`. Anywhere all three existing names co-occur is a
   hardcoded list — a Dockerfile `COPY`, a constant array, a test asserting
   the shared set, a docs sentence saying "three built-in shared themes." Add
   both new themes to each.
2. **Verify the image bundles themes by glob, not a named copy.** The design
   assumes the whole `themes/` dir is carried into `build/themes/`. Confirm it.
   If the Dockerfile copies an enumerated list of theme names, the new themes
   are invisible in production (and a local `bun --bun run dev` won't catch it,
   since dev resolves `apps/web/themes/` directly).
3. **Verify the subsystem-6 theme-picker enumerates dynamically.** The picker
   is expected to list the effective theme set (shared ∪ space `themes/`) at
   runtime, so the new themes appear automatically. Confirm there is no
   snapshot test or hardcoded option list that pins it to the current three.
4. **Update `docs/themes.md`.** The "three built-in shared themes" count
   appears in several sentences; each becomes five. Add `amber-press` and
   `amber-dusk` to the theme list. (Plus the dark-mode doc clarification from
   the `amber-dusk` section above.)

## Discovery & lifecycle (no new behavior)

- Theme discovery runs at cold start; adding a new theme directory requires a
  server restart (existing, documented behavior).
- Once discovered, editing files **within** a theme dir is picked up per
  request (templates read from disk; CSS served as an asset).
- Selection and resolution are unchanged: `space.toml` → `amber.toml` →
  `amber-default` → built-in floor.

## Testing & verification

- **Discovery/resolution:** if a test asserts the shared theme set or its
  count, update it to include both new themes (found via the ripple-checklist
  grep).
- **Contract conformance (manual, mockup-derived):** both themes are already
  prototyped (the brainstorming mockups); the real themes reproduce them
  within the file contract. Render the example space under each theme in both
  OS color schemes and confirm: light and dark both read well; only the 8
  color tokens differ between modes; nav, article header, prose, code block,
  blockquote, lists, auto-index, and the 404/error page all render; no literal
  colors leak outside the media blocks.
- **No-JS:** each page is complete with JavaScript disabled (trivially true —
  no `theme.js`).
- **Build:** after confirming the bundling mechanism (ripple-checklist item
  2), build the image (or simulate the copy) and confirm both themes land in
  `build/themes/`.

## Acceptance criteria

- [ ] `apps/web/themes/amber-press/` and `apps/web/themes/amber-dusk/` each
      exist with all required files, pass discovery, and render the example
      space.
- [ ] Each ships dark + light, with only the 8 color tokens differing between
      modes; no new `--amber-*` tokens (theme-local `--press-*` / `--dusk-*`
      only); no literal colors outside the media blocks.
- [ ] `chrome.html` byte-identical to `amber-default` in both; `page.html`
      uses only contract variables (no kicker/eyebrow).
- [ ] Every hardcoded "three themes" site (tests, docs, any Dockerfile/compose
      list) updated to five; build bundles both themes; theme-picker lists
      them.
- [ ] `docs/themes.md` updated: counts → five, both themes listed, dark-mode
      base-choice clarification added.
- [ ] No new dependencies; no `theme.js`; no `app.html` change; no loader /
      render / asset-route change.
