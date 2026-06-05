# Members link on the space admin index — spec

Status: **agreed design**, ready for a plan session.
Input: the per-space admin tree shipped by subsystems 3–6
(`apps/web/src/routes/admin/(authed)/spaces/[slug]/...`,
`requireSpaceAccess` populating `locals.role`), and specifically the
already-shipped members/invites page at
`/admin/spaces/[slug]/members` (subsystem 4) and the `canPickTheme`
affordance on the space index added by subsystem 6.

The spec answers *what exactly are we building*. It does not revise
`CLAUDE.md` — there is nothing to revise; this change reads
`locals.role` and writes nothing.

---

## 1. What this is

A pure discoverability fix. The members/invites management page
(`/admin/spaces/[slug]/members`) has been reachable since subsystem 4,
but **nothing links to it** — not the global admin nav, not the space
index page. The only way in is to know and type the URL. In
single-space mode this makes the invite-an-editor flow feel like it
doesn't exist, since there is no spaces list to browse and the global
nav only shows *Users / Account / Sign out*.

This change adds a single "Members" affordance to the space admin
index (`/admin/spaces/[slug]`), beside the existing "Theme: …"
affordance, gated to the same owner-or-install-admin tier. It makes an
existing, working page clickable. Nothing else changes: the members
page, its permission gate, the invite logic, and the CLI escape hatch
(`bin/grant-ownership.ts`) are all untouched.

### Non-goals

- No change to the members page, invite creation/redemption, or
  permission model.
- No new global-nav entry. The global admin nav
  (`apps/web/src/routes/admin/+layout.svelte`) has no current-space
  context in multi-space mode, so a per-space link there is out of
  scope.
- No per-space subnav / tab row across the `[slug]` children. That was
  considered and explicitly deferred in favour of the smallest change.
- No surfacing of invites on `/admin/users`. The install-wide user
  page stays install-wide.

## 2. The change

Three edits, all within the space index route.

### 2.1 Server — `spaces/[slug]/+page.server.ts`

Add one flag to the `load` return, computed identically to the
neighbouring `canPickTheme`:

```ts
const canManageMembers = locals.role === 'owner' || locals.role === 'install-admin';
```

It is named distinctly from `canPickTheme` rather than reused: theme
picking and member management are separate concerns that share a gate
*today*; collapsing them under one name would mislead if either gate
later diverges. The flag governs only whether the *link is shown* —
the members page itself already enforces
`requireSpaceAccess(event, slug, 'owner')`, so an editor who reached
the URL directly still gets a 403. Showing the link only to those who
can use it avoids dangling editors into a 403.

`canManageMembers` is added to the returned object alongside the
existing `pages`, `slug`, `activeThemeName`, `publicUrl`,
`canPickTheme`.

### 2.2 View — `spaces/[slug]/+page.svelte`

Add a `.meta` line below the Theme line, gated on `canManageMembers`,
using the established ghost-button + `resolve(...)` typed-route
pattern already used for the Theme "Change" link:

```svelte
{#if data.canManageMembers}
  <p class="meta">
    Members
    <a
      class="amber-btn amber-btn--ghost amber-btn--sm"
      href={resolve(`/admin/spaces/${data.slug}/members` as '/admin/spaces/[slug]/members')}
      >Manage</a
    >
  </p>
{/if}
```

Reuses the existing `.meta` style block — no new CSS.

### 2.3 Test — `spaces/[slug]/+page.server.ts` coverage

Extend the space-index server test to assert `canManageMembers`:

- `true` when `locals.role` is `owner`.
- `true` when `locals.role` is `install-admin`.
- `false` when `locals.role` is `editor`.

Match the exact shape of the existing `canPickTheme` assertions in that
test file (same role-stubbing harness, same call site).

## 3. Behaviour across modes

Identical in single-space and multi-space mode, because the space index
route and `locals.role` are mode-agnostic. In single-space mode the
slug is the space directory's basename (e.g. `example` for
`AMBER_SPACE_PATH=.../spaces/example`); `/admin` auto-redirects there,
so the install-admin lands on the index and now sees the Members link
without typing a URL.

## 4. Acceptance

- An owner or install-admin viewing `/admin/spaces/[slug]` sees a
  "Members → Manage" affordance that navigates to the members page.
- An editor viewing the same page does **not** see the affordance.
- Existing space-index tests still pass; the new `canManageMembers`
  assertions pass.
- No change to any other route, the permission model, or `CLAUDE.md`.
