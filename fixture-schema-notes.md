# Fixture build — schema ambiguities

Notes captured while building `apps/web/fixtures/example-space/` against
`apps/web/src/lib/types/schema.ts`. Each item is something the schema does not
pin down clearly enough for the loader to be written without a decision.

## 1. TOML serialization of the `kind` discriminator

`NavLeaf.kind = "page"` is mandatory in the TS type, but the schema does not
say whether `amber.toml` authors are expected to write `kind = "page"`
explicitly or whether the loader infers `"page"` from the presence of `path`.

The fixture writes `kind` explicitly on every entry. If the loader is going to
treat `kind` as optional-with-default (likely, for ergonomics), the fixture
under-tests the implicit case and a second variant should be added.

**Decision needed:** is `kind` required in TOML, or inferred?

## 2. URL of `projects/index.md`

The schema says URLs derive from filesystem paths and that folder-with-
`index.md` is the colocated-assets pattern, but never explicitly states that
`projects/index.md` resolves to `/projects` (vs. `/projects/index` or
`/projects/`).

`Space.pages` documents keys as "leading slash, no trailing, `/` for the root
index", so `/projects` is the only consistent reading — but it's worth a
docstring on `Page.url` pinning the rule.

**Decision needed:** add a one-line rule to the schema: "`<dir>/index.md` →
`/<dir>`; root `index.md` → `/`."

## 3. Root `index.md`

`Space.pages` mentions `"/"` for the root index, which implies a top-level
`index.md` is a recognised pattern, but nothing in the manifest or page schema
treats it specially. The fixture includes one (`index.md` at the space root →
`/`).

If instead the root is meant to come from a manifest field (a `home:` pointer,
say), this fixture is wrong.

**Decision needed:** is root content always `index.md`, or is the homepage
configurable in the manifest?

## 4. `slug` semantics on an `index.md`

The schema says `slug` "replaces the filename (but not parent directories)".
For `projects/index.md`, the "filename" is `index`, so a slug would presumably
replace the *folder-as-URL-segment* — but that contradicts "not parent
directories".

The fixture sidesteps it (no slug on any index file).

**Decision needed:** disallow `slug` on `index.md` (warn? error?), or define
how it interacts with the parent directory.

## 5. Colocated non-markdown assets

`projects/cover.png` is referenced by relative path from `projects/index.md`,
but the schema only models markdown `Page`s. Whether the loader should:

- index assets and expose them via `Space`,
- ignore them entirely and let a static handler serve them,
- or hand them to the render layer for URL rewriting,

is unspecified.

**Decision needed:** what does the loader do with non-`.md` files inside the
content tree? At minimum, the schema should say "out of scope, served by a
separate static handler" if that's the answer.

## 6. `updated` frontmatter field

Defined in `PageFrontmatter` but no page in the fixture sets it — there was no
natural reason to. If the loader has special behavior around `updated` (sort
key fallback when `date` is absent, RSS `<updated>`, sitemap `lastmod`), the
fixture won't cover it.

**Decision needed:** what is `updated` actually for? If it's just metadata for
themes, fine. If the loader uses it, document where.

## 7. Drafts and the page index — internal contradiction

The user-facing spec for the loader says: "keep drafts in the page index but
exclude them from nav and public routes."

The schema docstring on `Space.pages` says: "All **non-draft** pages, keyed by
URL path."

Those are in tension. Drafts are either in `Space.pages` or they aren't.

**Decision needed:** pick one. Options:

- A. `Space.pages` is non-draft only, drafts live on a separate `Space.drafts`
  map. Keeps consumers from accidentally rendering a draft.
- B. `Space.pages` includes drafts; each `Page` carries `frontmatter.draft` and
  consumers filter. Simpler shape, more responsibility on routes.

The fixture supports either; a decision unblocks the loader.

## 8. `reserved_name_in_content` warning is unreachable from this fixture

`LoadWarning.code` includes `"reserved_name_in_content"`, but the fixture
doesn't trigger it. None of the content paths start with `_` or `.` outside
the decoy directories, which the loader skips entirely at the top level.

To exercise it the fixture would need something like `posts/_wip.md` that the
manifest references — slightly contrived, since a user who creates `_wip.md`
inside content has already opted out by convention.

**Decision needed:** is this warning code real? When does the loader actually
emit it? If it's "manifest references a path with a reserved segment", say so;
if it's something else, define the trigger or drop the code.

---

# Fixture inventory

For reference, what's in `apps/web/fixtures/example-space/`:

```
amber.toml
index.md                          homepage; title + description
about.md                          plain top-level; title + description
hello.md                          slug: "say-hi" (filename ≠ URL)
projects/
  index.md                        folder-with-index; layout: page; refs cover.png
  cover.png                       colocated 1×1 PNG
  amber.md                        nested page; title + description + tags
  field-notes/
    index.md                      deeper nested folder-with-index
notes/
  2025-09-on-tea.md               date + tags + layout + author + title + description
  unfinished-essay.md             draft: true; not in manifest nav
_drafts/scratch.md                decoy (reserved prefix)
.hidden-thing                     decoy (reserved prefix)
themes/minimal/.gitkeep           decoy (reserved top-level)
.amber/.gitkeep                   decoy (reserved top-level)
```

Manifest covers: `amber_version`, full `[site]` block, four nav entries
(internal page → `about.md`; folder reference → `projects/index.md`;
slug-overridden page → `hello.md`; **missing target** → `talks.md`) plus an
external Mastodon link, and a `[redirects]` table with two entries.

Frontmatter coverage across pages: `title`, `description`, `slug`, `draft`,
`date`, `author`, `tags`, `layout`. `updated` deliberately not exercised — see
ambiguity #6.
