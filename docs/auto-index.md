# The `auto_index` frontmatter directive

A page can list the other pages in a directory by declaring `auto_index`
in its YAML frontmatter. This document is the content-author reference:
exactly what the directive accepts, exactly what it does, and what shows
up in the log when it goes wrong. For how the listing is rendered (the
theme partial, the variable name, what's swappable), read
[`themes.md`](themes.md#auto-index-and-partials).

## A working example

```yaml
---
title: Notes
auto_index:
  path: notes
  sort: date desc
  limit: 10
---

A running log. The list below is built from the markdown files in
the `notes/` directory of this space.
```

That page lives at `notes/index.md` and serves at `/notes`. Below the
prose, Amber renders a list of every other markdown file under `notes/`,
newest first, capped at ten.

## The directive

```yaml
auto_index:
  path: <directory>     # required
  sort: <sort order>    # optional, default "date desc"
  limit: <positive int> # optional, no cap by default
```

### `path` (required)

A directory under the space root. Forward slashes, **no leading slash**,
relative to the space's content root — not to the page's URL.

| You write          | Amber lists                                  |
| ------------------ | -------------------------------------------- |
| `notes`            | every page under `notes/...`                 |
| `writing/2026`     | every page under `writing/2026/...`          |
| `/notes`           | rejected — leading slash isn't a content path |
| `..`               | rejected — can't escape the content root     |
| `notes/./2026`     | normalized to `notes/2026`                   |
| `notes/`           | normalized to `notes`                        |

The directory must exist on disk when the page is loaded. The match is
recursive: `path: blog` includes `blog/post.md`, `blog/2025/post.md`,
`blog/drafts-archive/post.md`, and so on.

### `sort` (optional)

One of three string values, **space-separated** (not underscored):

- `date desc` (default) — newest first by `date` frontmatter, oldest last
- `date asc` — oldest first
- `title asc` — alphabetical by `title` frontmatter, case-insensitive,
  accent-folded (`é` sorts as `e`), pinned to English locale

Date sorts: pages without a parseable `date` go to the **end** of the
list regardless of direction, sorted among themselves by title. Within
the dated group, equal dates tie-break by title. Within the undated
group, by title. The result is deterministic across machines.

Title sort: equal titles tie-break by URL.

`title asc` falls back to the page's URL when `title` frontmatter is
absent; the URL is treated as the comparison key.

### `limit` (optional)

A positive integer. Applied **after** sorting, so `limit: 5` with
`date desc` returns the five newest pages. Omit it for an uncapped
list. Non-integers, zero, and negatives are rejected.

## What's in the list and what isn't

The listing is built from the live page set every time the page is
rendered, so it reflects watcher updates (a `git pull` on the server
adds new posts without a restart).

Included:

- Markdown pages whose path is strictly **inside** `path`
  (`blog/post.md` matches `path: blog`; `blog-sidecar.md` does not).
- The listed directory's own `index.md`, when it isn't the host page.

Excluded:

- The host page itself, even if it lives under `path` (a page can't
  list itself).
- Drafts (`draft: true` in frontmatter).
- Anything outside `path` — there's no cross-directory or tag-based
  inclusion. One directive, one directory.

Drafts are hidden from auto-index listings on public surfaces just as
they are from the nav and from public URLs. In dev they still serve as
their own page (with a draft banner) — they just don't appear in
listings.

## How each entry looks

Themes receive each entry as four fields. Authors don't usually need
this, but it's the contract a theme can rely on:

```js
{
  href:    "/notes/quiet",   // absolute path under the space
  title:   "Quiet",          // frontmatter title, falling back to the URL
  date:    "2026-04-22",     // frontmatter date, or null
  updated: "2026-04-30"      // frontmatter updated, or null
}
```

A theme might show `date` and not `updated`, or vice versa, or neither.
That's a theme decision; the data is always there if both are set.

## When things go wrong

A malformed `auto_index` directive is dropped from the page — the page
itself still renders, just without the listing. Amber logs one of three
warnings so you can find it in the dev console or the production log:

- `auto_index_path_missing` — `path` is missing, not a string, empty,
  contains `..`, or points at something that isn't a directory under
  the content root. Most "I changed nothing and the list disappeared"
  bugs are this — usually a leading-slash typo (`/notes`) or a renamed
  directory.
- `auto_index_invalid_sort` — `sort` isn't one of the three allowed
  values. Likely cause: underscore instead of space (`date_desc`
  instead of `date desc`).
- `auto_index_invalid_limit` — `limit` isn't a positive integer.

Each warning carries the page that triggered it, the warning code,
and a one-line explanation, and appears in Amber's startup / loader
log alongside the rest of the space's load output. The exact log
subsystem tag depends on which entry point loaded the space (cold
boot vs. a space hot-added through the admin UI emit under different
tags); grep the log for the warning code rather than a fixed tag.
The rest of the space loads normally.

## Limits and non-goals

Things `auto_index` deliberately does not do:

- **Filter by tag, prefix, or date range.** One directory, all
  non-draft pages inside it.
- **Combine multiple directives.** A page declares at most one
  `auto_index`. To list two directories on the same page, write the
  second list by hand.
- **Pagination.** `limit` caps; there's no `offset` or `page`. Long
  archives are a future increment.
- **Custom sort keys.** The three built-in sorts are the contract.

If one of these stops feeling like the right line, it's a roadmap
conversation, not a content-side workaround.
