# Amber — architectural rules and scope guards

This file is the source of truth for architectural intent. If something here
conflicts with code, the code is wrong or this file is out of date — fix one
of them, don't paper over the gap.

## What Amber is

A self-hostable personal canvas: link-in-bio, small site, notebook, blog.
Your software, your server, your files. Markdown on disk, no database
lock-in, AGPL-3.0.

## Stack — decided, not up for casual revision

SvelteKit + Bun + adapter-node. SQLite. Docker Compose. Caddy with automatic
Let's Encrypt. systemd for survival across reboots. restic to B2 for backups.
UptimeRobot for liveness.

Explicitly **not** in v0.1: Kubernetes, Portainer, Pangolin, Coolify,
Cloudflare in front, GitHub Actions CI, monitoring stacks, ORMs, UI component
libraries.

One server, one Compose file, one process. Every dependency justifies its
presence. Complexity is added when it's needed, not speculatively.

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

**Rendering is not the loader's job.** `Page.body` is raw markdown. HTML
rendering happens at request time, cached by content hash. The loader
produces an index of what exists; it does not decide what is shown.

**Route filtering is not the loader's job either.** Drafts are *in* the page
index. Consumers (nav builder, page handler, sitemap, RSS) decide what to
expose. See "Drafts" below.

**Server-only for content.** `+page.server.ts`, never `+page.ts`. Content
never crosses to the client as data — only as rendered HTML.

**Space directory path comes from `AMBER_SPACE_PATH`.** No hardcoded paths,
no config-file-pointing-to-config-file.

## On-disk format

A space is a directory containing `amber.toml` at its root. Visible markdown
files are content. `.amber/` holds regenerable runtime state (cache, drafts,
plugin state) and is safe to delete.

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

- v0.1: single-space link-in-bio + simple sites.
- v0.2: plugins, themes ecosystem, custom domains.
- v0.3: Tauri desktop app with local-disk sync.
- v0.4: multi-space, better-auth, CRDT-based collaboration.

Anything not in the current version is not a v0.1 design constraint.
Resist the urge to "leave room for" v0.4 in v0.1 code — the redirects table
reservation is the only speculative concession, and it's a five-line table.

## Scope guards

If a proposed change involves any of the following, push back hard or say
no:

- Adding a service to the Compose file.
- Adding a build-time dependency that isn't already in `package.json`.
- Putting content logic in a `+page.ts` (must be `.server.ts`).
- Writing through the cache without going through `apply()`.
- Modifying `amber.toml` from code.
- Introducing a UI component library, an ORM, or a CSS framework.
- Adding a CI service before there's a release to gate.
- Designing for v0.2+ features in v0.1 code paths.

If the change is genuinely needed and breaks one of these, the rule gets
revised here first, then the change lands. Not the other way around.