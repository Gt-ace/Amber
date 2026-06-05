# Editor curated toolbar — design spec

**Date:** 2026-06-05
**Status:** approved design, ready for implementation
**Companion docs:**
- Editor subsystem spec: [`docs/specs/v0.5-subsystem-1-editor.md`](./v0.5-subsystem-1-editor.md).
- Architectural rules: [`CLAUDE.md`](../../CLAUDE.md) (root) and
  [`apps/web/CLAUDE.md`](../../apps/web/CLAUDE.md).

---

## 1. Goal

The `/admin/.../edit` editor (Milkdown Crepe) already ships a rich feature set —
this install constructs Crepe with **no feature overrides**, so every Crepe
default is on. But the features are *hidden*: block inserts live behind the `/`
slash menu, and inline formatting (including **links**) only appears in a
floating toolbar when text is selected. A non-technical author — v0.5's target
user — does not discover them.

This change **surfaces** the existing features behind a persistent, always-visible
toolbar, **curated** so every control maps to markdown the public site can
actually render. It adds no new editing capability and changes nothing on disk.

## 2. The constraint that shapes the curation

The public renderer (`src/lib/render/render.ts`) is vanilla `markdown-it`,
default preset, **zero plugins**. So two features Crepe enables by default write
markdown the site cannot render:

| Feature | Saved markdown | Renders on public site? |
|---|---|---|
| **Math** (Crepe `Latex`) | `$E=mc^2$` | ❌ literal dollar signs |
| **Task list** (part of Crepe `ListItem`) | `- [ ] foo` | ⚠️ literal `[ ]`, no checkbox |

These are already reachable via the `/` menu today; a toolbar would make them
one-click prominent. To keep Amber's "what you author always round-trips to clean
markdown" promise, the toolbar **and** the slash menu drop both, so the editor
never advertises something the site silently degrades. (Re-adding either is a
*renderer* decision — `markdown-it-task-lists` is cheap, KaTeX is heavy — and is
explicitly out of scope here.)

## 3. Scope

One file, one function: the `new Crepe(...)` call in `onMount` of
`src/routes/admin/(authed)/spaces/[slug]/edit/[...path]/+page.svelte`. This is the
**only** Crepe-mounting component — `/admin/edit/[...path]` is a redirect shim
(subsystem-3 backward-compat), not a second editor.

**Out of scope / explicitly unchanged:** the markdown renderer, the on-disk
format, dependencies (`@milkdown/crepe` is already present), server/load code,
and the floating selection toolbar (kept — it complements the fixed bar for
inline formatting).

## 4. The change

Pass `features` + `featureConfigs` to the Crepe constructor:

| Setting | Effect |
|---|---|
| `features` → `top-bar: true` | Enables Crepe's sticky toolbar above the editor. |
| `features` → `latex: false` | Removes **math** from *both* the toolbar and the `/` menu — both are Latex-gated, so one flag does it. |
| `featureConfigs['top-bar'].buildTopBar` | Removes the **task-list** button from the toolbar's `list` group. The builder arrives pre-populated with the defaults; `getGroup('list').group.items` is the live array `build()` returns, so a `.filter(i => i.key !== 'task-list')` drops just that item — no icon/command reconstruction. |
| `featureConfigs['block-edit'].listGroup.taskList = null` | Removes **task-list** from the `/` slash menu too, keeping the two surfaces consistent. Partial override: `bulletList`/`orderedList` are untouched and stay. |

Feature keys may be written as the enum string values (`'top-bar'`, `'latex'`,
`'block-edit'`) or via `Crepe.Feature.*`; either avoids guesswork. Implementation
picks whichever reads cleanly with the existing dynamic import.

### Resulting toolbar

Heading dropdown (Paragraph / H1–H6) · **bold** · *italic* · ~~strikethrough~~ ·
inline-code · bullet list · ordered list · link · image · table · code-block ·
quote · divider. Every control round-trips to markdown the public site renders.

## 5. Why this needs no styling or dark-mode work

Crepe's `top-bar.css` is already loaded: the editor imports
`@milkdown/crepe/theme/common/style.css` (`+page.svelte:7`), which `@import`s
`top-bar.css` (line 13 of that file). The toolbar styles consume the same
`--crepe-color-*` variables the component's existing `@media (prefers-color-scheme:
dark)` block already overrides, so the bar follows OS dark mode for free.

## 6. Verification

- **Visual (Playwright, light + dark):** the sticky toolbar renders above the
  editor and is styled in both palettes; heading dropdown, link, and table
  buttons work; **math** and **task-list** are absent from *both* the toolbar and
  the `/` menu.
- **Round-trip:** insert a heading / link / table via the toolbar, save, confirm
  the saved file is clean markdown the public route renders correctly.
- **Existing gates:** `bun --bun vitest --run` stays green (no unit surface
  changes); the opt-in `test:smoke` e2e still passes. Consider extending the
  admin e2e to assert the toolbar (`.milkdown-top-bar`) is present.

## 7. Scope guards

None touched. No Compose service, no new dependency, no `+page.ts` content logic,
no cache write, no `amber.toml`/`space.toml` mutation, no UI component library /
ORM / CSS framework, no renderer change. The change is confined to how the
already-approved Crepe editor is configured.
