# Amber

Self-hostable personal canvas: link-in-bio, small site, notebook, blog.

Amber is software you run on your own server. Content is markdown files on
disk with no database lock-in. AGPL-3.0. You'd reach for Amber instead of a
Linktree, a Notion site, a Substack, or a static site generator when you
want a small personal space that is actually yours.

The position is anti-platform. Your software, your server, your files. Not
multi-tenant. Not a SaaS. Not a CMS. The data is markdown on a filesystem —
portable, greppable, editable in any editor, version-controllable with git.

## Quick start

```
git clone https://github.com/Gt-ace/Amber.git
cd Amber
docker compose up
```

Open <http://localhost:3000>. Edit files in `spaces/example/` to see
changes live.

The first visit to <http://localhost:3000/admin> redirects to
`/admin/setup` — that one-shot screen claims the admin account. Once
claimed, the setup page is sealed and `/admin` becomes the editor. The
desktop compose file ships a placeholder `AMBER_AUTH_SECRET`; rotate it
with `openssl rand -hex 32` before exposing this Amber to anyone (the
self-hosting guide threads a real secret through production).

## Status

Current version: 0.5. Early development. A production instance runs at
[amber.avp.software](https://amber.avp.software) — that is the operator's
personal site, which happens to run on Amber. It isn't Amber's homepage.

The substrate is stable. The theme contract has been exercised by two
themes. Per-space configuration works. As of v0.4 the desktop-developer
install above is the supported way to try Amber from a clone. The
self-hoster path (TLS, systemd, backups, your own domain) is documented
in [`docs/self-hosting.md`](docs/self-hosting.md).

v0.4 ships the desktop-developer `docker compose up` install, a per-space
registry refactor, and the self-hoster guide. v0.3 added per-space theming
via `space.toml` and a second bundled theme (`amber-editorial`).

The v0.5 authoring layer has shipped as six sequenced subsystems. Subsystem 1
(WYSIWYG editor at `/admin/edit/<page>`, Milkdown Crepe, client-only) has
shipped. Subsystem 2 (real authentication: `/admin/setup`, `/admin/login`,
`/admin/account`, optional Google sign-in, offline reset CLI) has shipped.
Subsystem 3 (multi-space routing: `AMBER_SPACES_DIR` discovery, per-space
`host`/`prefix`/`default` routing in `space.toml`, per-space admin at
`/admin/spaces/[slug]/…`) has shipped. Subsystem 4 (invites and per-space
permissions: install-admin tier over per-space owner/editor roles, bearer
URL invites delivered out-of-band, members admin at
`/admin/spaces/[slug]/members`, install-admin user list at `/admin/users`,
offline `bin/grant-ownership.ts` CLI) has shipped. Subsystem 5
(space-creation UI: install-admin-only `/admin/new-space` that writes
`amber.toml`, optional `space.toml` routing, and hot-adds the space into the
resolver) has shipped. Subsystem 6 (theme-picker UI: writes `space.toml`'s
`theme` field, owner-or-install-admin, hot-reloaded by the existing watcher)
has shipped, completing the authoring layer.

## Concepts

A **space** is a directory containing your content, configuration, and
themes. One Amber install hosts one or more spaces — single-space via
`AMBER_SPACE_PATH`, or multi-space via `AMBER_SPACES_DIR` (see
[`docs/self-hosting.md`](docs/self-hosting.md)).

**Content** is markdown files with YAML frontmatter. The filesystem is the
source of truth. SQLite at `.amber/cache.db` is a regenerable cache and can
be deleted without losing data.

A **theme** is a directory of CSS and HTML templates that decides
presentation. Each space picks its own theme. See
[`docs/themes.md`](docs/themes.md) for the contract.

## Docs

- [`docs/themes.md`](docs/themes.md) — building themes: file contract, CSS
  tokens, template runtime.
- [`docs/auto-index.md`](docs/auto-index.md) — the `auto_index`
  frontmatter directive (path/sort/limit, filtering rules, warnings).
- [`docs/self-hosting.md`](docs/self-hosting.md) — production deploy
  (TLS, systemd, backups, claiming the admin, recovery via the offline
  reset-password CLI).

More documentation will land as the project matures.

## What Amber is not

- Not a CMS.
- Not a SaaS.
- Not multi-tenant in the cloud sense.
- Not a static site generator. Pages render at request time and are cached
  by content hash.
- Not a no-code tool. Editing content means editing files.
- Not a platform.

## License

[AGPL-3.0](LICENSE).
