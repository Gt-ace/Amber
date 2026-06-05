# Changelog

All notable changes to Amber are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and Amber aims to follow [Semantic Versioning](https://semver.org/).

`0.5.0` is the first tagged release. The entries for `0.1`–`0.4` below are
reconstructed from the development roadmap in `CLAUDE.md`; they shipped during
May 2026 before the project began tagging, so they carry no precise release
date.

## [0.5.0] — 2026-06-05

The authoring layer: an in-browser editor and admin UI so non-technical people
can create and edit spaces without a terminal. Content stays plain markdown on
disk and config stays hand-editable TOML — this adds a friendlier way to write
those files, not a new place to keep them. Delivered as six sequenced
subsystems.

### Added

- **Editor** — WYSIWYG editing at `/admin/edit/<page>` that writes plain
  markdown to disk (Milkdown Crepe, client-only, contained to the editor
  bundle).
- **Authentication** — `better-auth` mounted at `/api/auth/*`: email+password
  sign-in with an optional Google provider, a one-shot `/admin/setup` claim
  screen, `/admin/account` for password changes and Google link/unlink, and an
  offline `bin/reset-password.ts` CLI. The admin row and sessions live in
  install-level `.amber/auth.db`.
- **Multi-space routing** — `AMBER_SPACES_DIR` discovery, per-space
  `host`/`prefix`/`default` routing fields in `space.toml`, and a per-space
  admin surface at `/admin/spaces/[slug]/…`. Single-space `AMBER_SPACE_PATH`
  behaviour is unchanged.
- **Invites & per-space permissions** — `member` and `invite` tables plus an
  `isInstallAdmin` column in `auth.db`; an install-admin tier over per-space
  owner/editor roles; single-use, 7-day, SHA-256-hashed bearer-URL invites
  generated from `/admin/spaces/[slug]/members`; an install-admin user list at
  `/admin/users`; and an offline `bin/grant-ownership.ts` CLI.
- **Space-creation UI** — install-admin-only `/admin/new-space` that writes
  `amber.toml` (and optional `space.toml` routing) on explicit user action and
  hot-adds the new space into the resolver index.
- **Theme-picker UI** — writes `space.toml`'s `theme` field
  (owner-or-install-admin), hot-reloaded by the existing `space_config_change`
  watcher path.
- **Install-level shared themes** — the three `amber-*` themes ship with the
  app (`apps/web/themes/`, carried into the image as `build/themes/`) and are
  available to every space; a space's own `themes/<name>/` still overrides a
  shared theme of the same name.
- **`amber-brand` theme** — Amber's own landing-page identity theme (self-hosted
  Fraunces + Hanken, progressive-enhancement motion, an optional light/dark
  preference toggle), serving [amber.avp.software](https://amber.avp.software).

### Changed

- `AMBER_DEV_UNSAFE` removed; real authentication replaces it.
- Architectural rules revised in `CLAUDE.md` to admit the authoring layer: the
  manifest may now be written on explicit user action (space-creation and
  theme-picker UIs), and the public render path's "no client JS" guard was
  carved out for the editor surface and the theme-preference toggle. The public
  page render path itself stays server-only.

## [0.4.0] — 2026-05 (pre-tag milestone)

### Added

- `getSpace()` per-space registry refactor (path-keyed `Map`; single-space
  behaviour unchanged).
- Desktop-developer `docker compose up` install path.
- Self-hoster documentation (`docs/self-hosting.md`): TLS, systemd, backups,
  recovery.

## [0.3.0] — 2026-05 (pre-tag milestone)

### Added

- Per-space theming via `space.toml` with a four-step theme-resolution chain.
- `amber-editorial` theme (Theme B) and the theme contract docs
  (`docs/themes.md`).
- README; per-space correctness for the theme asset route.

### Removed

- Dead `LoadWarning` codes.

## [0.2.0] — 2026-05 (pre-tag milestone)

### Added

- The `auto_index` frontmatter primitive (path/sort/limit).
- `amber-default` theme (Theme A).
- Hydration smoke as an operator-runnable pre-deploy gate.

### Fixed

- Render-cache key collision.

## [0.1.0] — 2026-05 (pre-tag milestone)

Initial substrate: single-space link-in-bio and simple sites.

### Added

- Filesystem loader as a pure function, with a watcher layering incremental
  updates on top.
- SQLite cache behind the loader interface (`.amber/cache.db`), a regenerable
  cache over the filesystem source of truth.
- Markdown→HTML render pipeline with a body-hash render cache.
- SvelteKit page handler backed by the `Space` singleton.
- Hardening: structured logging (pino), `sitemap.xml` / `robots.txt` / `og:*`
  meta tags driven from the live space, a shared layout + Amber-chrome 404
  page, render-cache vacuum on cold load, loader robustness
  (BOM/CRLF/unicode/empty/no-frontmatter inputs), and corrupt-cache recovery.

[0.5.0]: https://github.com/Gt-ace/Amber/releases/tag/v0.5.0
