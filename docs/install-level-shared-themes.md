# Install-level shared themes — problem brief

**Status: SHIPPED (2026-06-04).** This brief seeded the spec → plan → build
cycle and is kept for the trail. The design is in
[`docs/specs/v0.5-install-level-shared-themes.md`](specs/v0.5-install-level-shared-themes.md),
the implementation plan in
[`docs/plans/v0.5-install-level-shared-themes.md`](plans/v0.5-install-level-shared-themes.md),
and the shipped contract in [`docs/themes.md`](themes.md). In brief: the three
canonical themes moved to `apps/web/themes/` (app-bundled, carried into the
image as `build/themes/`, addressed via `AMBER_BUNDLED_THEMES_DIR`), are
discovered once at install scope, and merged into every space's effective theme
set (`shared ∪ <space>/themes/`, per-space wins). A freshly created space now
gets the real themes with no per-space copies and no restart. The "Open
questions" below were all resolved in the spec; the records are left intact.

Chosen direction (decided 2026-06-04): **install-level shared themes** — a theme
set discoverable once at the install level and available to every space, so a
space (especially a freshly created one) can pick a real theme without shipping
its own copy of the theme files. The two alternatives considered and rejected
were (a) seeding theme copies into every new space on creation, and (b) a
one-off manual copy. Both leave Amber's per-space-only theme model in place; the
shared-themes direction changes that model, which is why it needs its own
spec and a `CLAUDE.md` / `docs/themes.md` rule revision before any code.

## The problem (repro)

1. Create a new space through the admin UI (`/admin/new-space`).
2. Open its theme picker (`/admin/spaces/<slug>/theme`).
3. The only option is **"Use install default"** — no real themes to choose. The
   loader logs `available:[]` / "no usable amber-default theme found under
   themes/; using the built-in fallback theme", and the space renders with the
   unstyled built-in floor.

`example` and `avp-software` *do* show themes only because each ships committed
`themes/<name>/` directories in the repo. A user-created space ships none.

## Why it happens (current model)

Themes are **strictly per-space**. The relevant code:

- `lib/space/themes.ts` → `discoverThemes(root)` scans **`<space-root>/themes/`**
  only. No `themes/` dir (or an empty one) → an empty `Map`, no warning.
- `lib/space/load.ts:137` calls `discoverThemes(root, log)` with the space root.
- `lib/space/themes.ts` → `resolveActiveTheme(themes, manifest, spaceConfig)`
  resolves the active theme against **that per-space map**:
  1. `space.toml` `theme` → `themes.get(...)`
  2. `amber.toml` `theme` → `themes.get(...)`
  3. `amber-default` → `themes.get('amber-default')`
  4. built-in unstyled floor.
- Subsystem 6 picker (`routes/admin/(authed)/spaces/[slug]/theme/+page.server.ts`)
  builds its option list from `space.themes` (the per-space map).

The trap is **step 2**: `docs/themes.md` calls `amber.toml`'s `theme` field "the
install-level default", but it is only a *name* — it is still resolved against
the **per-space** discovered map (`themes.get(configured)`). So a name set
install-wide still requires the theme *files* to exist under each space's own
`themes/`. There is no shared theme *set* today. New spaces therefore fall
straight through to the built-in floor.

`new-space` (subsystem 5) scaffolds `amber.toml` + `index.md` only — by design,
it never seeds theme directories.

## What "install-level shared themes" should mean

A theme set discovered once at install scope and merged into every space's
available themes, so:

- Amber's bundled themes (`amber-default`, `amber-editorial`, and probably
  `amber-brand`) are pickable from **any** space out of the box, new ones
  included, with no per-space file copies.
- A space may still ship its **own** `themes/<name>/` to add a private theme or
  override a shared one — per-space stays authoritative where present.

## Open questions for the spec (not decisions — flag these)

- **Where do shared themes live on disk?** Candidates: app-bundled defaults that
  ship with Amber (so they exist with zero operator setup); and/or an
  install-root location the operator controls. Note the discovery-mode split:
  single-space (`AMBER_SPACE_PATH`) vs multi-space (`AMBER_SPACES_DIR`) — the
  shared location must be defined for both (e.g. the install root `.amber/` that
  already houses `auth.db` in multi-space mode is one precedent for "install
  scope, not inside any one space"). There is existing precedent for install-wide
  *assets*: `docs/themes.md` documents install-wide webfonts served from the
  app's static `/fonts/`.
- **Discovery + precedence.** Likely a shared discovery pass merged with the
  per-space pass, with per-space winning on name collision. Decide whether the
  built-in `amber-default` floor becomes a *real* shared theme (which would make
  step 3 of the resolution chain meaningful everywhere) or stays the in-app
  `BUILTIN_THEME`.
- **Resolution chain.** How shared themes enter `resolveActiveTheme`'s lookup;
  whether the `space_theme_not_found` warning semantics change.
- **Asset route.** `/themes/<name>/theme.css` (and `…/fonts/…`) is resolved
  per-space today; serving a *shared* theme's assets needs a path that isn't
  scoped to one space root. Mind the v0.3 "asset-route per-space correctness"
  work — don't regress it.
- **Picker UI (subsystem 6).** Show shared + per-space themes in one list,
  ideally labelled by source ("shared" vs "this space"); the `describeThemeSource`
  / "Currently rendering" line may need a new source value. Styling already
  migrated to the brand system — this is a data/labelling change, not a restyle.
- **Caching + watching.** The per-space theme set is cached in `.amber/cache.db`;
  `themes/` is deliberately *not* watched (restart to pick up new theme dirs).
  Decide how the shared set caches and invalidates, and keep the
  "filesystem is truth, cache is regenerable" rule.
- **Portability.** Per-space themes keep a space fully self-contained (move the
  directory, keep the look). Shared themes trade some of that for
  no-duplication; the spec should state the trade and how a moved space falls
  back (presumably to the built-in floor until the shared set exists at the new
  install).

## Scope-guard note (read `CLAUDE.md` first)

This changes the binding rule that **themes live per-space**
(`docs/themes.md`: "Themes live per-space under
`spaces/<space>/themes/<name>/`"). Per `CLAUDE.md`'s "revise the rule here
first, then the change lands" discipline, the spec must revise `docs/themes.md`
(and any `CLAUDE.md` theming statement) **with** the implementing change, not
after.

## Touch points (for the future spec's orientation)

- `lib/space/themes.ts` — `discoverThemes`, `resolveActiveTheme`,
  `describeThemeSource`, `DEFAULT_THEME_NAME`, `BUILTIN_THEME`.
- `lib/space/load.ts:137` — the single `discoverThemes(root, log)` call site.
- `routes/admin/(authed)/spaces/[slug]/theme/` — the picker (load + action + view).
- The `/themes/` asset route — per-space asset resolution.
- `docs/themes.md` — the theme contract (the rule to revise).
- `spaces/avp-software/themes/{amber-default,amber-editorial,amber-brand}/` —
  the bundled themes that would become the shared set.
