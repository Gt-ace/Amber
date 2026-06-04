# Known issues — post-v0.5 / post-brand-landing

The v0.5 roadmap (subsystems 1–6) and the amber-brand landing page have all
shipped. The test suite is green (607 unit/integration tests, `bun run check`
clean) as of this writing. What remains is a small, well-scoped backlog: one
real bug, some latent theme polish, documentation/version drift, and the
release mechanics this project has never exercised.

Priorities are P0 (fix now) → P3 (housekeeping). Items under **Deferred** are
explicitly out of scope by the architectural rules in `CLAUDE.md`; they are
recorded here so "we chose not to" is distinguishable from "we forgot."

---

## P0 — Per-space new-page action is broken (and hides an authz gap)

**Status: fixed in this change.** Recorded here for the trail.

`routes/admin/(authed)/spaces/[slug]/new/+page.server.ts` had two defects, both
rooted in the same SvelteKit fact: **a form `action` runs before any layout
`load`**, so neither the `[slug]` layout's space resolution nor its access
guard is in effect when the action body runs.

- **Crash (functional).** Both `load` and the create `action` read
  `locals.space`, which the `[slug]` layout sets *in its `load`*. During a POST
  that `load` hasn't run, so `locals.space` is `null` and the action threw
  `Error('locals.space not set by [slug]/+layout.server.ts')`. Every "Create
  page" submission 500'd — the feature was entirely non-functional in
  production.

- **Authz gap (security, discovered while fixing the crash).** Because the
  action bypasses the `[slug]` layout `load`, it also bypasses that layout's
  `requireSpaceAccess(event, slug)` guard. The crash masked this today, but a
  crash-only fix (just resolve the space) would let **any logged-in user create
  files in any space**, member or not — a privilege-escalation regression. The
  `handle` hook sets `locals.user` on every request but enforces no per-space
  membership, so nothing else closes the gap.

**Fix.** Mirror the sibling handlers that already get this right — the PUT save
endpoint (`spaces/[slug]/api/page/[...path]/+server.ts`) and the theme action
(`spaces/[slug]/theme/+page.server.ts`). Both re-resolve the `Space` from the
registry by slug (`getRegistryEntries().find((e) => basename(e.path) === slug)`)
**and** re-assert `requireSpaceAccess` inside the handler. The new-page action
now does the same with minimum role `'editor'` — identical to the save endpoint,
which is correct: creating a page and then editing it are the same trust level.

The bug was latent because the unit tests faked `locals.space` and hardcoded a
slug that never had to match the registry; the e2e suite never submits the
create form. The regression test added with the fix drives the action the way
real SvelteKit does (no faked `locals.space`, slug = the registry's basename)
and asserts a non-member is 404'd **with no file written**.

(Previously flagged in working memory as `locals-space-null-in-post-actions`.)

---

## P1 — amber-brand theme: missing latent CSS (not visible on the live page)

**Status: fixed in this change.** Both class sets are now styled in
`amber-brand/theme.css` (draft callout: full accent-tinted border + leading
status dot, no side-stripe; auto-index: ruled list with Fraunces display titles
and right-pushed mono dates), verified rendered in light and dark with the real
fonts. Recorded here for the trail.

The `amber-brand` theme (now `apps/web/themes/amber-brand/`) referenced
two classes in its templates that have no CSS. Neither is exercised by the live
`avp-software` space (its three pages use no `draft:` and no `auto_index`), so
nothing renders unstyled **today** — but any future draft or auto-index page on
this theme would.

- **`.draft-banner`** — rendered by `page.html` (`{{#is_draft}}<p class="draft-banner"…`)
  but unstyled. `amber-default/theme.css` has the pattern to copy
  (border + padding + background).
- **`.amber-auto-index` / `-item` / `-link` / `-date`** — the
  `partials/index.html` auto-index partial exists, but the list has no styles.
  Again, `amber-default/theme.css` is the reference.

~30 lines total, following existing amber-default patterns.

---

## P2 — Documentation / version drift

**Status: fixed in this change.** README and `amber.toml` now read `0.5`;
`docs/themes.md`'s intro acknowledges `amber-brand` as a third shipping
theme; `docs/current-state.md` reflects subsystem 6 as shipped (and prod on
`amber-brand`); the `amber-brand/theme.css` header no longer claims a "first
pass … only"; and the `amber-brand-landing-plan` working-memory note reads as
built. Recorded here for the trail.

Cosmetic but trail-confusing; none block functionality.

- `README.md` — "Current version: 0.4"; v0.5 subsystems 1–6 have shipped.
- `spaces/avp-software/amber.toml` — `amber_version = "0.3"`.
- `docs/themes.md` — intro says "the two themes that ship with Amber today";
  `amber-brand` is now a third shipping theme (it is mentioned later in the
  file but not the intro).
- `docs/current-state.md` — says subsystem 6 (theme-picker) is "the
  unambiguous next code work"; it has since shipped (the route exists at
  `spaces/[slug]/theme/`). The doc predates the `CLAUDE.md` update.
- `spaces/avp-software/themes/amber-brand/theme.css:12` — stale header comment
  ("this first pass covers @font-face, tokens, base/type, header and footer
  only"); the theme now has hero, the-bet, themes, editor, article, and error
  pages.
- Working memory `amber-brand-landing-plan` says "planned, not built" — it is
  built and on `main`.

---

## P3 — Release mechanics (never exercised)

**Status: gate cleanup + verification done in this change; the release act
(tag + `CHANGELOG`) is deliberately deferred.** Recorded here for the trail.

For an AGPL self-hostable project that is feature-complete through v0.5, this
is the "make it official" gap.

- **No git tags, no `CHANGELOG`** — still true, deferred on purpose. Cutting a
  tag forces a coherent version, but `main` currently disagrees with itself
  (README "0.4", `amber.toml` "0.3" — the P2 drift above). The release act is
  left as a separate, deliberate step *after* the P2 version drift is settled,
  per the doc's own "a dedicated cleanup pass *before* any tagged release"
  framing. The production instance still tracks `main`.
- **`bun run check` and `bun run lint` were both red on `main`; both are now
  green** (the "no CI by design" gates had drifted; pre-existing, unrelated to
  any single change). The fix was scoped to keep the public render path
  untouched — the route `+page.server.ts` annotations were left as-is rather
  than switched to `satisfies` (which would narrow the generated
  `PageServerData`/`ActionData` and ripple into every `.svelte` consumer).
  - `check`: was 33 `svelte-check` errors. Two shapes, both **type-position
    only** (the handlers genuinely export what the tests reference):
    `typeof import('…').actions.default` does namespace-style dotted access
    through `typeof import()`, which rejects the `Actions` index signature →
    switched to indexed access `actions['default']`; and `load`-return types
    resolved as `… | void` because `export const load: PageServerLoad` widens
    the return → cast at the call site via a documented per-file
    `type LoadData = Exclude<…, void>`. Plus the `inviteUrl` discriminated-union
    narrowing miss in `members/+page.svelte` (fixed with `{@const}` to capture
    the value outside the closure), three `Space`-cast errors in
    `resolver-index.test.ts` (`as unknown as { id: string }`), and two
    untyped `.map()` callbacks that fell out of the void cast (explicit param
    type). The 22 `svelte-check` **warnings** (`state_referenced_locally`,
    `a11y_autofocus`) are pre-existing and do not fail the gate — `check` exits
    0 with them present.
  - `lint`: the doc undercounted this. Prettier reported ~53 files of style
    drift (fixed by `bun run format`), but `prettier --check` short-circuits
    `&& eslint .`, so **eslint had never run** — it surfaced **12 hidden
    errors** once prettier passed: `preserve-caught-error`, `no-useless-assignment`
    (×3), `no-empty` catch blocks (×2), an unused var, and
    `svelte/no-navigation-without-resolve` (×5). The navigation ones split by
    intent — external/`/api/auth/*` links got the codebase's `eslint-disable`
    convention (one of which was silently mis-targeted after a prettier wrap;
    re-done as a block disable), the internal `/admin/login` link got
    `resolve()`. The fast unit suite (`bun test`, 609 green) was the only gate
    already clean; it stays green, as does `test:smoke` (21).
- **Pre-deploy gates — both run and green.** `test:smoke` (the hydration gate)
  rebuilds the production bundle under Bun, boots it, and drives it in Chromium:
  21 e2e tests pass. A standalone production build also emits adapter-node
  output. One sharp edge worth recording: plain `bun run build` fails in any
  environment where Node is on `$PATH` — `vite`'s `#!/usr/bin/env node` shebang
  hands the build to Node, whose loader can't resolve the `bun:sqlite` import
  (`lib/space/cache.ts`). The build must run under Bun (`bun --bun run build`).
  The prod Docker `build` stage is `oven/bun:1` (Node-free), so the bare
  `bun run build` in the Dockerfile is unaffected; only mixed local shells hit
  this. A one-line hardening — make the `build` script `bun --bun vite build`,
  matching the `test:*` scripts — would make it robust everywhere; left
  unchanged for now (the Dockerfile is correct as-is).
- **Stale local branches pruned.** `feat/editor`, `feat/multi-space-routing`,
  `feat/wave3-p1-per-space-theming`, `fix/multi-space-routing-followups`, and
  `spec/editor` were all fully merged into `main` and deleted with
  `git branch -d`. `spike/editor-roundtrip` is correctly left unmerged and
  kept. (The earlier `feat/auth` listing was stale — no such local branch
  existed.)

---

## Deferred — explicitly out of scope (per `CLAUDE.md`)

Recorded so the choice is visible. Do not build these without revising the
relevant scope guard first.

- **RSS / feeds** — "RSS/sitemap concerns aren't in v0.1 scope; revisit when
  feeds ship." Sitemap/robots/og already shipped; RSS has not.
- **auto-index pagination** (`offset`/`page`) — `docs/auto-index.md` calls
  long-archive pagination "a future increment."
- **Multiple `auto_index` directives per page** — documented non-goal; a page
  declares at most one.
- **Redirects table UI** — the table is "reserved from day one even if unused";
  no UI exposes it. The five-line reservation is the only speculative concession
  the rules allow.
- **Symlink validation in content discovery** —
  `lib/space/load.ts` TODO: "symlinks aren't validated — revisit when a real
  use case appears."
- **Native desktop app (Tauri)** — off-roadmap by design; the authoring layer
  ships as web routes.
