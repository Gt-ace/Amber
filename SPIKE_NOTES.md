# Theme spike — notes

Throwaway exercise (v0.2, pre-Wave-2). Goal: find out what a "theme" is by
writing one. **None of this is the theme system.** It's hardcoded into the app
so we can look at it and then write the Wave 2 prompt from what we learned.

## What I built

One real content page — `spaces/avp-software/test.md` ("About") — rendered with
a deliberate design instead of the placeholder readable-defaults stylesheet.

- `apps/web/src/app.css` — fully rewritten. The whole theme: tokens + selectors.
- `apps/web/src/routes/+layout.svelte` — chrome markup (header/nav/footer) +
  the `app.css` import + `theme-color` meta. Annotated as spike code.
- `apps/web/src/routes/[...path]/+page.svelte` — article markup (title, date,
  body). Annotated as spike code.
- `spaces/avp-software/test.md` — added `date: 2026-04-22` and `slug: about`
  to frontmatter (the page needed a date to exercise date display; `slug`
  gives it a URL worth putting in the nav).
- `spaces/avp-software/amber.toml` — added two `[[nav]]` entries (`About`,
  external `Source`) so the nav is actually demonstrable.

**Couldn't get a live preview running in this environment** — `bun --bun run
dev` / `vite dev` get killed here (the SQLite cache needs Bun, and Bun-spawned
long-running processes don't survive the sandbox). `bun run check` (svelte-kit
sync + svelte-check) passes clean: 0 errors, 0 warnings. Run `bun --bun run
dev` locally with `AMBER_SPACE_PATH=spaces/avp-software` and visit `/about`.

## The design, briefly

A quiet, warm, book-like reading surface. "Amber" as in resin — something
personal, kept, unhurried. Old-style serif (system stack — `Iowan Old Style` /
`Palatino` / `Georgia`) for the prose. The *same* family, set small / uppercase
/ letter-tracked, for all the chrome (nav, date, footer) — so the page is one
voice, not "content font + UI font". Deep amber/ochre as the only accent
(links, list markers, hover). Hairline rules, no boxes, no cards. One subtle
entrance animation (a 6px fade-up on the article, ~360ms, behind
`prefers-reduced-motion`), then nothing moves. A `prefers-color-scheme: dark`
block remaps the colour tokens and nothing else.

## What files a theme would need (the actual finding)

Minimum viable theme = **one CSS file + a small set of templates + a manifest**:

1. **`theme.css`** — the token block (`:root { --amber-* }`) and the selectors.
   This is 90% of a theme. Plain CSS, no build. Lives in the theme directory,
   gets linked into `<head>`. The dark-mode variant is just another `:root`
   block inside the same file under a media query — *not* a separate file, and
   not a separate "dark theme".

2. **Templates** — there's a real split that the SvelteKit layout/page
   boundary already mirrors:
   - a **chrome template** (header + nav + footer) — wraps everything, gets
     `site` + `nav`.
   - a **page template** (article: title + date + body) — gets one `Page`.
   - implied but not exercised here: an **error/404 template**. The current
     `+error.svelte` renders into the same `<main>` and inherits the styling
     for free, which is a hint that "404 is just a page the chrome wraps."
   So: ~2–3 templates. The spike used `.svelte` files because that's what's
   there; a theme system would need its own templating story (whatever it is,
   it needs: `site.title`, `nav[]` of `{label, href}`, and per-page `title` /
   `date` / `html`).

3. **A theme manifest** — even this tiny theme surfaced things that want to be
   declared, not hardcoded: the footer ("Source → repo" — where does that text
   and link come from? the theme? `amber.toml`?), the `theme-color` values
   (they duplicate `--amber-bg` light/dark — a theme should declare them once),
   maybe the default `og:` image. Small file. Name, version, maybe a
   `colors.light` / `colors.dark` echo for `theme-color`, footer slot config.

4. **Fonts** — *open question, deliberately dodged.* I used a system serif
   stack so the spike doesn't make a self-hosted canvas phone a font CDN on
   every page load. But a real theme will want to ship a face. So the theme
   directory probably also needs a `fonts/` folder + `@font-face` rules in
   `theme.css` pointing at theme-relative URLs — which means **themes need to
   be served as static asset roots**, not just CSS+templates. That's the one
   structural requirement I'd flag hardest for Wave 2.

So, concretely, a theme directory looks roughly like:

```
themes/<name>/
  theme.toml        # manifest: name, version, theme-color, footer slot, …
  theme.css         # tokens + selectors (light + dark in one file)
  templates/        # chrome, page, error  (format TBD)
  fonts/            # optional, @font-face targets — implies static serving
```

## The variable surface (`--amber-*`)

These are the knobs a second theme would plausibly want. Grouped; full
inline comments live at the top of `app.css`.

**Colour (8)** — `--amber-bg`, `--amber-ink`, `--amber-ink-muted`,
`--amber-accent`, `--amber-accent-hover`, `--amber-rule` (hairlines),
`--amber-surface-sunken` (code fills), `--amber-selection-bg`.
→ *Finding:* this is the entire colour story. Light vs dark = remap these 8,
nothing else. A theme could honestly be "the default theme with a different 8".

**Type (12)** — `--amber-font-body`, `--amber-font-heading`, `--amber-font-ui`
(chrome), `--amber-font-mono`; `--amber-text-base`, `--amber-text-sm`,
`--amber-text-h1/h2/h3`; `--amber-leading-body`, `--amber-leading-tight`;
`--amber-tracking-ui` (the uppercase-chrome letter-spacing).
→ *Finding:* the type *scale* (h1/h2/h3/sm) wants to be a scale, not five
unrelated numbers — but I left it explicit because the spike doesn't know yet
whether themes think in ratios or in absolute sizes. `--amber-font-ui`
defaulting to `--amber-font-body` is the spike's whole "one voice" decision
sitting in one variable; a sans-chrome theme flips exactly that.

**Space & layout (5)** — `--amber-measure` (column width — the single most
"theme-defining" number after the accent colour), `--amber-pad-page`,
`--amber-gap-flow` (block rhythm), `--amber-gap-section` (above headings),
`--amber-gap-chrome` (chrome ↔ content).
→ *Finding:* `--amber-measure` does a lot of work. Everything is `max-width:
var(--amber-measure); margin-inline: auto` — header, article, footer all share
it. A theme that wanted a sidebar or a wide hero would need more than a single
measure, so this is where the "just make one page right" constraint is showing.

**Shape & motion (4)** — `--amber-radius`, `--amber-ease`, `--amber-duration`.
(`--amber-radius` is currently used by exactly two things — code blocks and
images. Honest take: borderline whether it earns being a token at this scale,
but a flatter/rounder theme would want it.)

Total: ~29 custom properties. Feels like the right order of magnitude — small
enough to document on one page, expressive enough that a genuinely different
theme is reachable by overriding them.

## What felt awkward

- **"One layout file" vs SvelteKit reality.** The task said one layout file;
  SvelteKit splits chrome (`+layout.svelte`) from content (`+page.svelte`) and
  you can't collapse that — page data only exists in `+page`. So I touched
  three existing files (+ the CSS). That's not a problem with the spike, it's a
  finding: the theme system's templating *will* have a chrome/page split, and
  it should just own that instead of pretending it's one file.

- **The footer has nowhere to come from.** I hardcoded `Source → GitHub` in
  `+layout.svelte`. It wants to be configured. First real "the manifest needs a
  slot for this" moment.

- **`{@html}` content can't use scoped styles.** All the markdown-body
  styling (`.article-body h2`, `…blockquote`, `…pre`, …) has to live in the
  global `app.css`, scoped by hand under `.article-body`, because Svelte's
  component-scoped `<style>` can't see injected HTML. Fine here (the theme *is*
  a global stylesheet) — but worth knowing: a theme's CSS is inherently global,
  there's no "scoped theme". Two themes can't coexist; switching = swapping the
  whole stylesheet.

- **Date normalization.** `date: 2026-04-22` in YAML becomes `2026-04-22` or
  midnight-UTC ISO depending on the YAML parser; I format with `timeZone:
  'UTC'` and a pinned locale so it doesn't slip a day or mismatch on hydration.
  A theme author shouldn't have to know that. Date *formatting* (long? ISO?
  relative?) is clearly a theme decision, but the gotcha should be handled
  upstream — give themes a clean `Date` or a pre-formatted string, not the raw
  frontmatter value.

## What surprised me

- **How little there is.** A real, opinionated, not-ugly theme is ~29
  variables and ~250 lines of plain CSS. The "theme system" doesn't need to be
  big. The risk for Wave 2 is over-engineering it.

- **Colour is almost the whole thing, and it's only 8 values.** Light/dark
  isn't a feature, it's two of the eight bindings. Whatever Wave 2 builds, "a
  theme declares N colour tokens, optionally twice" covers more ground than I
  expected going in.

- **The chrome wanted the *content* font, not a UI font.** My instinct was
  "serif body, sans nav" (the editorial cliché). Setting the nav/date/footer in
  the same serif — small, uppercase, tracked — is what made it feel like *one
  site* instead of a CMS theme. So `--amber-font-ui` exists, but the
  interesting default is that it points at `--amber-font-body`. A theme system
  that assumes "body font + separate UI font" would be encoding the wrong
  default.

- **`--amber-measure` is load-bearing for the whole identity.** Change that one
  number and the page stops feeling like this and starts feeling like a blog
  template. More than the fonts, even. Worth making it prominent in the docs.

## Suggested shape for the Wave 2 prompt

1. Theme = directory with `theme.toml` + `theme.css` + templates (+ optional
   `fonts/`). Served as a static root so font/asset URLs are theme-relative.
2. `theme.css` owns `:root { --amber-* }` (light) and a
   `@media (prefers-color-scheme: dark)` remap. ~30 documented tokens.
3. Templates: `chrome` (site + nav + footer-slot), `page` (title + date + body),
   `error`. Templating mechanism TBD — needs `site`, `nav[] {label,href}`,
   page `title`/`date`/`html`.
4. Loader hands templates a *clean* date (formatted or `Date`), not raw
   frontmatter. Footer text/links come from `theme.toml` (or `amber.toml` —
   decide).
5. Don't generalise past that. The default theme above is the conformance test:
   if the system can express it without hardcoding, it's enough for v0.2.
