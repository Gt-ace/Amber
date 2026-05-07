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

There isn't any. Content hash *is* the key, so a body change produces a
new key and the old row is orphaned. Orphans are cheap (a few hundred
bytes each, on a single user's machine), and we don't ship eviction or a
vacuum step this sprint. If a space accumulates enough render orphans to
matter, deleting `.amber/cache.db` is always safe — the next cold start
rebuilds it.

## Sanitization

We don't sanitize. `html: false` blocks raw HTML *injection through
markdown* (a `<script>` tag in source becomes `&lt;script&gt;` in output),
which is enough while markdown source is the operator's own files. When
plugins or user-submitted content arrive, revisit this — a
DOMPurify-style sanitizer at the cache boundary is the natural seam, and
the content hash makes the result trivially cacheable.
