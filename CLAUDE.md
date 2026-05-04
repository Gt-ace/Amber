# CLAUDE.md

Guidance for Claude Code working in this repo. Keep this file current; stale
instructions are worse than none.

## What Amber is

A self-hostable personal canvas — link-in-bio, small site, notebook, or blog,
depending on what the user needs. The pitch: your software, your server, your
files. Markdown on disk, no database lock-in, AGPL-3.0.

The product principle that drives most decisions: **the user's content is files
on their disk, not rows in our database.** Anything that violates this needs an
explicit justification.

## Repo layout

```
amber/
├── apps/
│   └── web/              SvelteKit app (Bun runtime, adapter-node)
├── docker-compose.yml    production deploy: app + Caddy
├── Caddyfile             TLS termination, reverse proxy to app
└── CLAUDE.md             this file
```

Future: `apps/desktop/` (Tauri, v0.3), `packages/` for shared code. Don't create
these speculatively.

## Stack (decided, not up for debate in passing)

- **Runtime:** Bun. Use `bun` for install/run/test, not npm/pnpm/yarn.
- **Framework:** SvelteKit with `@sveltejs/adapter-node`.
- **Storage:** Markdown files on disk are the source of truth. SQLite (when it
  arrives) is a regenerable cache at `.amber/cache.db` inside the space dir,
  never the source of any user-visible fact.
- **Deploy:** One Hetzner box, Docker Compose, Caddy in front, systemd for
  boot. No Kubernetes, no Coolify, no Cloudflare proxy, no GitHub Actions CI
  yet. Deploy is `git pull && docker compose up -d`.

Things explicitly rejected for v0.1: Kubernetes, Portainer, Pangolin, Coolify,
Cloudflare in front, GitHub Actions CI, monitoring stacks, ORMs, UI component
libraries. Every dependency must justify its presence.

## On-disk format

A space is a directory containing `amber.toml` at its root.

- **Visible files** are content (markdown).
- **`.amber/`** is regenerable runtime state (cache, drafts, plugin state).
  Safe to delete; rebuilds on next boot.
- **`themes/`** holds installed themes.
- **Reserved names:** `amber.toml`, `.amber/`, `themes/`, plus any path segment
  starting with `_` or `.`.

Manifest is TOML, frontmatter is YAML. Manifest is authoritative for nav order;
filesystem is authoritative for what exists. Folder-with-`index.md` enables
colocated assets. Drafts are `draft: true` frontmatter, not a directory. URLs
derive from filesystem paths with frontmatter `slug:` as escape hatch.

The full schema lives at `apps/web/src/lib/types/schema.ts`. That file is the
contract — don't modify shapes there casually; manifest changes need an
`amber_version` bump and a migration plan.

## Architecture rules

1. **Filesystem is truth.** Routes resolve URLs through a Space loader that
   reads from disk. SQLite caches the parsed result; if the DB vanishes, we
   rebuild from disk. Don't add features that require the DB to be present.
2. **Loader and watcher are one subsystem.** A `Space` object owns the
   in-memory index, exposes `load()` for cold start and `apply(event)` for
   incremental updates. The watcher feeds events in. SQLite writes are a side
   effect of `apply()`, not a separate code path.
3. **Manifest is never silently rewritten.** If a nav entry points at a missing
   file, drop it from the in-memory nav and add a `LoadWarning`. The user (or a
   future admin UI) edits `amber.toml`; we don't.
4. **Rendering is not the loader's job.** `Page.body` is raw markdown; HTML
   rendering happens at request time, cached by content hash. Theme changes
   shouldn't require a reload.
5. **Server-only for content.** Use `+page.server.ts`, not `+page.ts`, for
   anything that touches the filesystem. Keep the FS as a server boundary.

## Conventions

- **Imports:** `$lib/...` for the SvelteKit app's own code. Types live under
  `$lib/types/`, server-only code under `$lib/server/`.
- **Path config:** The space directory path is read from `AMBER_SPACE_PATH` in
  `hooks.server.ts`. Dev defaults to `./fixtures/example-space` (once that
  exists); prod is a Docker volume mount. No clever auto-detection.
- **Tests:** Vitest. Pure functions (loader, parsers, URL derivation) get unit
  tests against fixture spaces in `apps/web/fixtures/`. Don't write
  integration tests against a live SvelteKit server until there's a reason.
- **Commits:** Conventional commits (`feat:`, `chore:`, `fix:`, `docs:`). Small
  and logical — one concern per commit.

## What's done

- Hetzner CX22 provisioned, hardened (SSH keys only, ufw, fail2ban).
- Docker Compose + Caddy + systemd, surviving reboots.
- Placeholder nginx serving `amber.avp.software` with Let's Encrypt TLS.
- SvelteKit app scaffolded at `apps/web` with adapter-node.
- On-disk schema types committed.

## What's next (immediate)

1. Fixture space at `apps/web/fixtures/example-space/` covering the schema's
   interesting cases (nested folders, `index.md`, slug overrides, drafts,
   external nav, redirects).
2. Space loader: pure function, takes a directory path, returns a `Space`.
   Tested against the fixture before any route uses it.
3. Watcher + incremental updates against the same `Space` interface.
4. Minimal catch-all route that renders pages through the loader.
5. SQLite cache layer behind the loader (transparent to routes).
6. Replace nginx in the Compose file.

Don't get ahead of this list. SQLite before the loader works against pure
filesystem is the wrong order.

## What NOT to do without asking

- Add a dependency. State the case first; "X uses it" isn't enough.
- Touch `docker-compose.yml`, `Caddyfile`, or anything outside `apps/web` until
  the app is ready to replace the nginx placeholder.
- Push to the remote. Commits are reviewed locally first.
- Add UI styling, themes, or component libraries. Themes are a v0.2 concern
  with their own architecture; don't pre-commit to one.
- Introduce auth, multi-user concepts, or any database table for user data.
  v0.1 is single-space, single-operator.

## When in doubt

Smaller PRs. Pure functions over framework integration. Filesystem over
database. Ask before adding scope.