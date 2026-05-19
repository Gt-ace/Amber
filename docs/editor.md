# The in-browser editor

Amber's `/admin` editor writes plain markdown to disk — the same files git
and any external editor see. Saving a page runs its body through a markdown
formatter, which **normalizes** some constructs. This is expected behavior,
not data loss: the output is always valid, portable, human-readable markdown,
and it is idempotent (a second save changes nothing).

What the formatter normalizes:

- Bullet lists use `*` markers.
- Table cells are padded to align columns.
- Hard line breaks are written as a trailing `\`.
- **Tight lists become loose lists** — each list item is wrapped so it renders
  with a little more vertical spacing. This is the one normalization with a
  visible rendering effect; a theme can flatten it in CSS if it matters.
- Exactly one blank-line is kept between a page's frontmatter and its body.

Editing a page's **frontmatter** through the side panel rewrites the YAML
block: hand-written comments and key order in that block are not preserved.
Editing only the body leaves the frontmatter block byte-for-byte untouched.
If a page's frontmatter YAML cannot be parsed, the panel is read-only and a
body-only save preserves the block verbatim — fix the YAML in the file to
re-enable the panel.
