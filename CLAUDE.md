# Amber — architectural rules and scope guards

This file is the source of truth for architectural intent. If something here
conflicts with code, the code is wrong or this file is out of date — fix one
of them, don't paper over the gap.

## What Amber is

A self-hostable personal canvas: link-in-bio, small site, notebook, blog.
Your software, your server, your files. Markdown on disk, no database
lock-in, AGPL-3.0.

Through v0.4 Amber is a *renderer*: content is authored on disk with an
external editor and git, and Amber turns it into a served site. v0.5 begins
an **authoring layer** — an in-browser editor and admin UI so non-technical
people can create and edit content without a terminal. The authoring layer
does not change what Amber *stores*: content stays plain markdown on disk,
config stays hand-editable TOML. It adds a friendlier way to write those
files, not a new place to keep them. Amber is solo-by-default; multi-user
(invited authors, per-space permissions) is opt-in, not assumed. See
"Roadmap shape" for the sequenced subsystems.

## Stack — decided, not up for casual revision

SvelteKit + Bun + adapter-node. SQLite. Docker Compose. Caddy with automatic
Let's Encrypt. systemd for survival across reboots. restic to B2 for backups.
UptimeRobot for liveness.

Explicitly **not** in v0.1: Kubernetes, Portainer, Pangolin, Coolify,
Cloudflare in front, GitHub Actions CI, monitoring stacks, ORMs, UI component
libraries.

One server, one Compose file per environment (`compose.yaml` for desktop
dev, `compose.prod.yaml` for production), one process. Every dependency
justifies its presence. Complexity is added when it's needed, not
speculatively.

## Architecture — the rules that shape everything

**Filesystem is truth. SQLite is a regenerable cache** at `.amber/cache.db`.
Deleting the cache must never lose user data. If a discrepancy arises, the
filesystem wins.

**Loader and watcher are one subsystem.** A `Space` object owns the in-memory
index, exposes `load()` for cold start and `apply(event)` for incremental
updates. SQLite writes are a side effect of `apply()`, not a separate
pipeline. The watcher runs in all environments; production hot-reloads
content on `git pull`.

**Manifest is never silently rewritten.** Missing nav targets are dropped
from the in-memory nav with a `LoadWarning`. The on-disk `amber.toml` is the
user's file; we read it, we don't edit it.

> *Authoring-layer revision (v0.5+):* the space-creation and theme-picker
> subsystems will write `amber.toml`/`space.toml` — but only on explicit
> user action through the admin UI, never silently, and the result stays
> hand-editable TOML. This rule is revised *with* those subsystems' code,
> not before. Until then it holds exactly as written.

**Rendering is not the loader's job.** `Page.body` is raw markdown. HTML
rendering happens at request time, cached by content hash. The loader
produces an index of what exists; it does not decide what is shown.

**Route filtering is not the loader's job either.** Drafts are *in* the page
index. Consumers (nav builder, page handler, sitemap, RSS) decide what to
expose. See "Drafts" below.

**Server-only for the public render path.** The public page route is
`+page.server.ts`, never `+page.ts`; public content never crosses to the
client as data — only as rendered HTML. The authenticated `/admin/edit`
editor is a separate surface and necessarily receives the page body as
editable data; that is by design and does not relax the public render path.

**Space directory path comes from `AMBER_SPACE_PATH`.** No hardcoded paths,
no config-file-pointing-to-config-file.

## On-disk format

A space is a directory containing `amber.toml` at its root. Visible markdown
files are content.

`.amber/` holds runtime state. Most of it is *regenerable* — `cache.db`,
the render cache, drafts, plugin state — and is safe to delete; the next
cold start rebuilds whatever is needed. The exception is
**`.amber/auth.db`** (landed in v0.5 subsystem 2), which holds the admin
user row and active sessions. Deleting it loses the admin account; the
operator either restores from backup or claims a fresh admin via
`/admin/setup`. Backup guidance covers `.amber/` as a whole, so any
sensible backup of the space directory picks `auth.db` up automatically.

- TOML for the manifest, YAML for frontmatter.
- Manifest is authoritative for **nav order**. Filesystem is authoritative
  for **what exists**.
- Folder-with-`index.md` is the colocated-assets pattern.
- `amber_version` in the manifest gates migrations.
- Redirects table is reserved from day one even if unused.
- Theme contract (file layout, `--amber-*` tokens, template runtime) is documented in [`docs/themes.md`](docs/themes.md).

### Reserved names

`amber.toml`, `.amber/`, `themes/`, plus the `_*` and `.*` prefixes anywhere
in the content tree. The top-level reserved-prefix scan is **silent** — those
directories are skipped without warning, by design (they're scratch/decoy
space).

## URL derivation rules

URLs derive from filesystem paths. The rules, exhaustively:

- `foo.md` → `/foo`
- `foo/bar.md` → `/foo/bar`
- `foo/index.md` → `/foo` (folder-with-index, colocated assets pattern)
- root `index.md` → `/` (the homepage is always `index.md` at the space
  root; it is **not** configurable via the manifest)
- `slug:` frontmatter replaces the filename-as-URL-segment, never parent
  directories

`Space.pages` keys: leading slash, no trailing slash, `/` for the root
index. This is the canonical form everywhere.

### Slug on `index.md` is an error

`slug:` semantics are "replace the filename." `index.md` has no
filename-as-URL-segment to replace — its segment comes from the parent
directory. Setting `slug` on an `index.md` is therefore semantically
incoherent and the loader emits a `LoadError`, not a warning. Users who want
a different URL should either rename the file or restructure.

## Drafts

Drafts are `draft: true` in frontmatter, **not** a directory.

`Space.pages` includes drafts. Each `Page` carries `frontmatter.draft`.
Consumers filter:

- Nav builder skips drafts when constructing the public nav.
- Page handler returns 404 for drafts on public routes.
- Future preview/admin routes can render drafts because they're in the
  index.

This is the "loader produces; consumers decide" rule applied to drafts.

## Manifest schema decisions

### `kind` is inferred, not required

For nav entries: `path = "..."` implies `kind = "page"`, `url = "..."`
implies `kind = "external"`. Authors *may* write `kind` explicitly; the
loader accepts it but does not require it. Inference is unambiguous because
`path` and `url` are mutually exclusive.

If a future entry kind is added that can't be disambiguated by field
presence, that's when `kind` becomes required for that variant — not
before.

### Non-markdown files in the content tree

Out of scope for the loader. A separate static handler serves them. The
loader does not index assets, does not rewrite asset URLs, does not validate
references.

## `LoadWarning` codes

Every code in the enum must have a defined trigger. The loader emits:

- `frontmatter_parse_error` — a page's YAML frontmatter block is malformed;
  the page is included in the index with empty frontmatter so the rest of
  the space still builds.
- `duplicate_url` — two pages resolve to the same URL (e.g. a `slug:`
  collision, or `foo.md` colliding with `foo/index.md`). First one wins;
  later ones are dropped from `Space.pages`. Asymmetry: in `apply()`, if
  the *winner* is unlinked the suppressed loser does **not** auto-promote
  (the loser's content isn't kept around). A subsequent `change` on the
  loser, or any cold start, picks the right winner. Cold start is
  authoritative; live state can lag.
- `auto_index_path_missing`, `auto_index_invalid_sort`,
  `auto_index_invalid_limit` — Wave 3 P1 `auto_index` frontmatter is
  malformed. Each warning drops the directive; the page still renders.
- `space_config_invalid` — `space.toml` exists but failed to parse, isn't
  a top-level table, or its `theme` field isn't a string. The space loads
  normally; the theme resolver falls through.
- `space_theme_not_found` — `space.toml` or `amber.toml` named a theme
  that isn't a discovered directory under `<space>/themes/`. The chain
  falls through.

If a code can't be triggered by any code path, it gets removed from the
enum. Unreachable codes are bugs.

## `updated` frontmatter field

Theme-facing metadata for v0.1. The loader does nothing special with it —
sort keys fall back from `date` to filesystem `mtime` if absent. Themes may
display it. RSS/sitemap concerns aren't in v0.1 scope; revisit when feeds
ship.

## Build order — done in v0.1 to date

1. Fixture space at `apps/web/fixtures/example-space/` covering the
   schema's interesting cases.
2. Loader as a pure function, tested against the fixture.
3. Watcher and incremental updates, layered on the loader.
4. SQLite cache behind the loader interface.
5. Markdown→HTML render pipeline with body-hash render cache.
6. SvelteKit page handler + Space singleton replacing the nginx placeholder.
7. v0.1 hardening sprint: structured logging (pino, single subsystem-tagged
   logger in `lib/server/logger.ts`); sitemap.xml/robots.txt/og:* meta tags
   driven from the live Space (drafts filtered at the consumer); shared
   layout + Amber-chrome 404 page (`+layout.server.ts`, `+error.svelte`,
   optional `/404` page from the space); render-cache vacuum on cold load;
   loader robustness against BOM/CRLF/unicode/empty/long-line/no-frontmatter
   inputs; corrupt-cache-file recovery. No new top-level deps beyond pino.

The first real (non-fixture) Amber space lives at `spaces/avp-software/` —
the landing page Amber serves about itself. Future build-order work picks
up from a working content pipeline; the substrate is in place.

## Roadmap shape

- **v0.1 (shipped):** single-space link-in-bio + simple sites. Loader,
  watcher, SQLite cache, markdown→HTML render pipeline, SvelteKit page
  handler with the `Space` singleton, hardening sprint (structured
  logging, sitemap/robots/og meta, shared layout + Amber-chrome 404,
  render-cache vacuum, loader robustness, corrupt-cache recovery).
- **v0.2 (shipped):** the `auto_index` frontmatter primitive, Theme A
  (`amber-default`), render-cache key fix, hydration smoke as an
  operator-runnable pre-deploy gate.
- **v0.3 (shipped):** per-space theming via `space.toml` with a
  four-step theme-resolution chain, Theme B (`amber-editorial`),
  `docs/themes.md`, README, asset-route per-space correctness, dead
  `LoadWarning` codes removed, `amber_version` → 0.3.
- **v0.4 (shipped):** `getSpace()` per-space registry refactor
  (path-keyed `Map`, single-space behaviour unchanged); desktop-developer
  `docker compose up` install path; self-hoster documentation.
- **v0.5 onward — the authoring layer.** The direction is decided: an
  in-browser editor and admin UI so non-technical people can build and
  edit spaces without a terminal. It is a platform-sized change and ships
  as six sequenced subsystems, each its own spec → plan → build cycle:

  1. **The editor (shipped)** — WYSIWYG editing that writes plain markdown
     to disk. Built on Milkdown Crepe (client-only, `/admin/edit` bundle
     only); the dependency scope guard was revised with this subsystem.
  2. **Auth (shipped)** — `better-auth` mounted at `/api/auth/*`,
     email+password sign-in with an optional Google provider, a one-shot
     `/admin/setup` claim screen, an `/admin/account` page for password
     changes / Google link-unlink, and an offline reset-password CLI for
     self-hosters who already have shell access. `AMBER_DEV_UNSAFE` is
     **removed**; the `.amber/auth.db` and `better-auth` dependency scope
     guards were revised with this subsystem.
  3. **Multi-space routing** — host/path resolution (the v0.4 registry
     refactor half-unblocked this).
  4. **Invites + per-space permissions** — opt-in multi-user.
  5. **Space-creation UI** — writes `amber.toml`.
  6. **Theme-picker UI** — writes `space.toml`.

  Build order is risk-first. Subsystem 1 (the editor) is **spiked before
  any binding rule is revised** — "a WYSIWYG editor that round-trips to
  *clean, portable* markdown" is the riskiest unproven assumption. If the
  spike holds, the rule revisions land subsystem by subsystem. If it
  doesn't, the direction is reconsidered cheaply.
- **Off-roadmap:** native desktop app (Tauri wrapper). Possible someday,
  not a current direction — self-hostable canvas is Amber's identity. The
  authoring layer is delivered as web routes in the existing SvelteKit
  app, not a desktop wrapper.

Anything not in the current version is not that version's design
constraint. Resist the urge to "leave room for" later versions in
current code — the redirects table reservation is the only speculative
concession, and it's a five-line table.

## Scope guards

If a proposed change involves any of the following, push back hard or say
no:

- Adding a service to the Compose file.
- Adding a build-time dependency that isn't already in `package.json`.
  (`better-auth` is permitted — see "Roadmap shape": v0.5 subsystem 2's
  load-bearing library, server-only, contained to the admin surface and
  the `/api/auth/*` handler. It is a specialized auth library, not a
  general-purpose framework.)
- Putting content logic in a `+page.ts` (must be `.server.ts`).
- Writing through the cache without going through `apply()`.
- Modifying `amber.toml` from code.
- Introducing a generic UI component library, an ORM, or a CSS framework.
  (The Milkdown **Crepe** markdown editor is permitted — see "Roadmap
  shape": it is the load-bearing component of v0.5 subsystem 1, proven by
  the round-trip spike, client-only, and contained to the `/admin/edit`
  route's bundle. It is a specialized editor, not a generic component library.)
- Adding a CI service before there's a release to gate.
- Designing for future-version features in current code paths.

Two of these guards still sit on the authoring layer's path and will be
revised as its subsystems land (see "Roadmap shape"): `amber.toml` /
`space.toml` writes from the space-creation and theme-picker UIs, and a
UI component library if the editor needs one. The `better-auth`
dependency was revised with v0.5 subsystem 2's code, in line with this
section's "the rule gets revised here first, then the change lands" rule.
The remaining guards hold until the subsystem that revises each one ships
*with* its rule revision — the authoring layer does not get to
pre-emptively waive them.

If the change is genuinely needed and breaks one of these, the rule gets
revised here first, then the change lands. Not the other way around.