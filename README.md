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

## Status

Current version: 0.3. Early development. A production instance runs at
[amber.avp.software](https://amber.avp.software) — that is the operator's
personal site, which happens to run on Amber. It isn't Amber's homepage.

The substrate is stable. The theme contract has been exercised by two
themes. Per-space configuration works. As of v0.4 the desktop-developer
install above is the supported way to try Amber from a clone. The
self-hoster path (TLS, systemd, backups, your own domain) is the
remaining gap and is in progress.

v0.3 ships per-space theming via `space.toml`, theme-author documentation,
and a second bundled theme (`amber-editorial`).

## Concepts

A **space** is a directory containing your content, configuration, and
themes. One Amber install hosts one or more spaces — currently one in
practice; multi-space is on the roadmap.

**Content** is markdown files with YAML frontmatter. The filesystem is the
source of truth. SQLite at `.amber/cache.db` is a regenerable cache and can
be deleted without losing data.

A **theme** is a directory of CSS and HTML templates that decides
presentation. Each space picks its own theme. See
[`docs/themes.md`](docs/themes.md) for the contract.

## Docs

- [`docs/themes.md`](docs/themes.md) — building themes: file contract, CSS
  tokens, template runtime.

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
