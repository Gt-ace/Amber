# `lib/space` — loader, watcher, cache

The space subsystem owns Amber's in-memory representation of an on-disk
space. The filesystem is the source of truth; this module makes that truth
queryable and reactive.

## API

```ts
import { Space } from '$lib/space/space';
import { SpaceWatcher } from '$lib/space/watcher';

const { space, warnings } = Space.load(process.env.AMBER_SPACE_PATH!);
const watcher = new SpaceWatcher(space);
await watcher.ready();

// later, on shutdown:
await watcher.close();
space.close();
```

`Space.load(path, { cache?: boolean })` returns `{ space: Space, warnings }`.
The `Space` instance exposes `manifest`, `pages` (URL → `Page`), `nav`,
`redirects`, and `warnings` — the same shape the pure `load()` returns —
plus `apply(event)` and `close()`. Pass `{ cache: false }` to skip the
SQLite layer (used by isolation-sensitive unit tests).

`apply(event)` mutates the index in place and returns the _newly added_
warnings produced by the event. Warnings that go away as a result of the
event (e.g. a `manifest_nav_missing_target` invalidated by the previously
missing file appearing on disk) reflect in `space.warnings` shrinking, not
as negative entries in the delta. The cumulative live array on the instance
is the union of `load()`'s warnings and every successful `apply()`'s effect
minus invalidations.

`SpaceWatcher` is a chokidar-based event source that normalizes raw
filesystem events into `FsEvent` values and feeds them into
`space.apply()`. The watcher debounces per-path on a 50 ms trailing edge,
collapses add+unlink-within-window pairs to nothing, and ignores reserved
paths (`.amber/`, `themes/`, `_*`, `.*`) so the cache writing into
`.amber/cache.db` never feeds back into `apply()`. `amber.toml` is the one
exception — it surfaces as a `{ type: 'manifest_change' }` event that
triggers a full manifest reparse and nav reconciliation.

## `FsEvent`

```ts
type FsEvent =
	| { type: 'add'; path: string } // space-relative, posix separators
	| { type: 'change'; path: string }
	| { type: 'unlink'; path: string }
	| { type: 'manifest_change' }; // path is implicitly amber.toml
```

`apply()` switches on `type`. `add` and `change` re-parse the page;
`unlink` removes it; `manifest_change` re-reads `amber.toml` and
recomputes redirects. Nav reconciliation runs after every event so missing-
target warnings track the live page set.

## Cache

`.amber/cache.db` is a SQLite database holding nothing the filesystem
doesn't — parsed page rows, manifest mtime, and per-page warnings. On cold
start, `Space.load()` validates the cache by walking the content tree and
matching mtimes; any drift falls through to a fresh `load()` and rewrites
the cache. Deleting `.amber/cache.db` while the server is running is
always safe; the next cold start rebuilds it. Cache writes inside `apply()`
are wrapped in a transaction and best-effort: a failure logs a warning and
leaves the in-memory index untouched.
