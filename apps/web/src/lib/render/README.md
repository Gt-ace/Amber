# `lib/render` — markdown → HTML

Two files, one job: turn `Page.body` into HTML, fast on the second hit.

`render(md): string` (in `render.ts`) is a pure function over markdown-it
configured with `html: false`, `linkify: true`, `typographer: false`. The
config is locked because it's load-bearing for the cache: identical input
bytes must produce identical output bytes, regardless of locale or
environment, or cache hits stop being meaningful. Plugins (footnotes,
anchors, syntax highlighting) deliberately wait for a later sprint.

`getOrRenderHtml(space, page)` (in `cache.ts`) wraps `render()` with the
SQLite `renders` table that lives in `<spaceRoot>/.amber/cache.db`
alongside the rest of the Space cache. The cache key is **sha256 of
`Page.body`** — not the URL, not the relative path, not `Page.contentHash`
(which hashes the full file including frontmatter). Two pages with
identical bodies share a cache row by design; rendering is a function of
body bytes, so the cache key is too.

## Cache invalidation

Content hash _is_ the key, so a body change produces a new key and the
old row is orphaned. Orphans accumulate in the `renders` table whenever a
`Page.body` changes. To bound growth, `Space.load()` calls
`space.vacuumRenderCache()` at the end of cold start (and on the
hydration path): it computes the set of currently-active body hashes
across `space.pages` and deletes any `renders` row whose `content_hash`
isn't in that set. The number of removed rows is logged at info level.

Restart-to-vacuum is the policy. There is no scheduled job, no
admin-triggered vacuum, no per-event cleanup inside `apply()` — the
orphan rate per event is tiny, and rescanning every page body for each
event would dominate the apply cost. Deleting `.amber/cache.db` remains
safe at any time; the next cold start rebuilds it.

## Sanitization

We don't sanitize. `html: false` blocks raw HTML _injection through
markdown_ (a `<script>` tag in source becomes `&lt;script&gt;` in output),
which is enough while markdown source is the operator's own files. When
plugins or user-submitted content arrive, revisit this — a
DOMPurify-style sanitizer at the cache boundary is the natural seam, and
the content hash makes the result trivially cacheable.
