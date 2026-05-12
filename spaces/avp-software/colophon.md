---
title: Colophon
description: What this site is built from, and why it's built that way.
date: 2026-05-12
slug: colophon
---

Every page you're reading is a markdown file in a git repository. There is no
database to migrate, no admin panel to log into, no platform that can change
the terms underneath it. This page describes the machinery, because a site
that explains how it's made is a site you can rebuild.

## The shape of it

Amber treats the **filesystem as truth**. A space is a directory with an
`amber.toml` at its root and markdown files for content. SQLite sits behind
that as a *regenerable cache* — delete `.amber/cache.db` and nothing is lost;
the loader rebuilds it from the files on disk. If the cache and the files ever
disagree, the files win. That single rule is what keeps the project honest:
there is no state worth protecting that isn't already a file you can read.

Rendering happens at request time. The loader's job is to produce an index of
*what exists*; it doesn't decide what's *shown*. Drafts live in the index;
the page handler returns a 404 for them on public routes. Nav order comes from
the manifest; what exists comes from the filesystem. Each subsystem knows one
thing.

## The stack

- **SvelteKit + Bun**, `adapter-node`, one process.
- **SQLite** via `bun:sqlite` — no ORM.
- **Caddy** out front for automatic TLS from Let's Encrypt.
- **systemd** so it survives reboots; **restic** to Backblaze B2 for backups;
  **UptimeRobot** for a heartbeat.
- One server, one Compose file. A Hetzner CX23 in Falkenstein does the whole
  job.

That's the list. Kubernetes, a CDN in front, a monitoring stack, a CSS
framework, a component library — none of it is here, and the absence is the
point. Complexity gets added when something needs it, not in case something
might.

## Themes are CSS and three templates

A theme is `chrome.html`, `page.html`, `error.html`, and a `theme.css` that
defines a small set of `--amber-*` variables. The app owns the `<main>`
landmark so a theme can't drop it; everything else — the masthead, the type,
the rhythm — belongs to the theme. The page you're on right now is rendered by
**amber-editorial**: a neo-grotesque for the interface, a humanist sans for
this prose, hairline rules, no rounded corners, a single cobalt accent. Its
sibling, **amber-default**, is the warm serif book. Same templates, opposite
posture — proof that the contract holds without the themes looking anything
alike.

> Your software, your server, your files. The rest is detail.

## Reading the source

If you want the real version of any of this, it's in the open:

```sh
git clone https://github.com/Gt-ace/Amber
```

The architectural intent — the rules that don't bend — lives in `CLAUDE.md` at
the repo root. If the code and that file ever disagree, one of them is a bug.

The site is licensed AGPL-3.0. Take it, run it, change it; just keep it open.
