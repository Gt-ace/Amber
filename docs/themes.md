# Theming Amber

A theme is how an Amber space looks. This document is the reference and a
guided tour of the two themes that ship with Amber today —
[`amber-default`](../spaces/avp-software/themes/amber-default/) and
[`amber-editorial`](../spaces/avp-software/themes/amber-editorial/) — read as
the contract. Anything not proven by one of those two themes is not yet part
of the contract.

The audience is someone who can read CSS and HTML and wants to build their
own theme. It assumes nothing about the Amber source.

## What a theme is

A directory of CSS and HTML templates that decides how a space's content is
presented. Themes live per-space under `spaces/<space>/themes/<name>/`. Each
space picks its theme via its own `space.toml`, with fallbacks to the
install-level `amber.toml`, then `amber-default`, then a built-in floor.

Themes are vanilla CSS and HTML. No build step, no framework. A theme *may*
ship one optional `theme.js` purely for progressive-enhancement motion — the
page must be complete and functional without it (see
[`theme.js`](#themejs) below) — but there is no other scripting hook, and
nothing the theme ships is bundled or compiled. The theme directory you ship
is the theme that runs.

## File contract

A usable theme directory contains exactly these files. The order below is
the order you'd build them in.

```
spaces/<space>/themes/<your-theme>/
  theme.toml          metadata
  theme.css           --amber-* tokens + styles
  chrome.html         site shell (header, nav, footer)
  page.html           page template
  error.html          error / 404 template
  theme.js            (optional) progressive-enhancement motion, ES module
  partials/
    index.html        (optional) auto-index list template
  fonts/              (optional) self-hosted @font-face files for brand themes
```

`theme.toml`, `theme.css`, `chrome.html`, `page.html`, and `error.html` are
all required. Theme discovery skips any directory missing one of the three
template files or with an unparseable `theme.toml`, and logs a warning;
the rest of the space still loads. Directory names starting with `.` or `_`
under `themes/` are ignored by discovery — useful for work-in-progress.

### `theme.toml`

A small TOML manifest. Three required scalars, two optional tables:

```toml
name = "your-theme"
version = "0.1.0"
author = "You"
description = "Optional one-liner."

# Optional. Mirrors --amber-bg light/dark from theme.css so the browser's
# UI chrome (Safari address bar, Android status bar) tints to match.
[theme_color]
light = "#faf7f0"
dark = "#1a1714"

# Optional. The chrome.html footer renders this as a labelled link after
# the site title. Omit the table to omit the link.
[footer]
label = "Source"
href = "https://example.com"
```

Both tables are optional. If you omit `[footer]`, `chrome.html` still
renders — the `{{#footer_href}}` block in the chrome template just produces
nothing. If you omit `[theme_color]`, no `<meta name="theme-color">` tags
are emitted.

The manifest is read once at cold start. Editing `theme.toml` and reloading
the page does not pick up changes; restart the server.

### `theme.css`

The stylesheet. Conventionally has two parts:

1. A `:root` block defining `--amber-*` custom properties.
2. The styles that consume them, scoped to the markup `chrome.html` and
   `page.html` produce.

`theme.css` is served by Amber's asset route at `/themes/<your-theme>/theme.css`
and linked from the root layout. You do not need to register it anywhere.

### `chrome.html`

The site shell. The theme owns the header, navigation, and footer.
**Amber owns the `<main>` landmark** — your chrome must not contain one.

The chrome template contains one mandatory marker: the literal HTML comment
`<!--amber:content-->`. The root layout splits the rendered chrome on this
marker, wraps the content in an app-owned `<main>`, and concatenates the
three parts. The marker must sit between two balanced top-level elements
(typically `</header>` and `<footer>`), never inside one — each half is
inserted as `{@html}` and must be a well-formed fragment, or hydration will
desync.

This is `amber-default`'s `chrome.html` in full:

```html
<header class="site-header">
	{{#site_title}}<a href="/" class="site-title">{{site_title}}</a>{{/site_title}}
	{{#has_nav}}
	<nav class="site-nav" aria-label="Primary">
		<ul>
			{{#nav}}<li><a href="{{href}}">{{label}}</a></li>{{/nav}}
		</ul>
	</nav>
	{{/has_nav}}
</header>
<!--amber:content-->
<footer class="site-footer">
	<span>{{site_title_or_default}}</span>
	{{#footer_href}}<a href="{{footer_href}}">{{footer_label}}</a>{{/footer_href}}
</footer>
```

The variables available to `chrome.html`:

| Variable | Type | What it is |
| --- | --- | --- |
| `site_title` | string or empty | `[site].title` from the space's `amber.toml`, or empty if unset. |
| `site_title_or_default` | string | Same as `site_title` but falls back to `"Amber"`. Useful for the footer where you always want a name. |
| `has_nav` | boolean | True iff the space has any visible nav entries. |
| `nav` | array of `{href, label}` | Nav entries. Drafts and missing targets are already filtered out by the loader. |
| `footer_label` | string | The `[footer].label` from your `theme.toml`. |
| `footer_href` | string or empty | The `[footer].href` from your `theme.toml`. Empty if you omitted the table. |

### `page.html`

The page body. Wrapped in the `<main>` the layout owns, between the two
halves of the rendered chrome. `amber-default`'s template:

```html
{{#is_draft}}<p class="draft-banner" role="status">
	Draft — visible in development only. This page returns 404 in production.
</p>{{/is_draft}}
<article>
	{{#has_header}}<header class="article-header">
		{{#title}}<h1 class="article-title">{{title}}</h1>{{/title}}
		{{#date_display}}<p class="article-date">
			<time datetime="{{date_iso}}">{{date_display}}</time>
		</p>{{/date_display}}
	</header>{{/has_header}}
	<div class="article-body">{{{html}}}</div>
	{{{index_html}}}
</article>
```

The variables available to `page.html`:

| Variable | Type | What it is |
| --- | --- | --- |
| `is_draft` | boolean | True in dev for pages with `draft: true` frontmatter. Always false in production (drafts 404 there). |
| `is_home` | boolean | True only for the space's root index (`/`). Lets one `page.html` render a landing layout on the homepage and an article layout elsewhere via `{{#is_home}}…{{/is_home}}` / `{{^is_home}}…{{/is_home}}`. |
| `has_header` | boolean | True iff the page has either a `title` or a parseable `date`. Wrap your title/date block in `{{#has_header}}` so pages with neither don't render an empty header. |
| `title` | string or empty | `title` from frontmatter. |
| `date_iso` | string or empty | The raw ISO 8601 `date` from frontmatter — suitable for a `<time datetime="…">` attribute. |
| `date_display` | string or empty | The date formatted for display (long month, UTC, pinned `en-US` locale so SSR and hydration agree). Empty if `date` is missing or unparseable. |
| `html` | raw HTML | The rendered markdown body. Use the triple-brace form `{{{html}}}` — it's HTML, not text. |
| `index_html` | raw HTML | The auto-index list, when the page has an `auto_index` directive. Empty string otherwise. Use the triple-brace form. |

### `error.html`

The error and 404 body. Like `page.html`, it renders inside the
layout-owned `<main>`. Unlike the other templates, `error.html` is rendered
**client-side** by `+error.svelte` — the layout's server load reads it from
disk and ships its raw source to the client.

`amber-default`'s template:

```html
{{#is_404}}{{#has_body}}{{{body}}}{{/has_body}}{{^has_body}}<h1>Page not found</h1>
<p>The page you were looking for doesn't exist.</p>
<p><a href="/">Back to home</a></p>{{/has_body}}{{/is_404}}{{^is_404}}<h1>{{status}}</h1>
<p>{{message}}</p>
<p><a href="/">Back to home</a></p>{{/is_404}}
```

The variables:

| Variable | Type | What it is |
| --- | --- | --- |
| `is_404` | boolean | True iff `page.status === 404`. |
| `has_body` | boolean | True iff the space provides a `/404` page. |
| `body` | raw HTML | The rendered HTML of `/404.md` if the space defined one. Empty otherwise. Triple-brace. |
| `status` | number | The HTTP status (e.g. 500, 503). |
| `message` | string | The error message, falling back to `"Something went wrong."`. |

The structure of the template — a `{{#is_404}}` branch with a
`{{#has_body}}` / `{{^has_body}}` fork inside, plus an `{{^is_404}}` branch
for everything else — is the contract. A space can ship its own
`spaces/<space>/404.md` to customize 404 copy without touching the theme.

### `partials/index.html`

Optional. Used when a page has `auto_index` frontmatter to render the
generated list. If you don't ship one, Amber falls back to a minimal
built-in partial — adequate but ugly. The contract is described under
[Auto-index and partials](#auto-index-and-partials) below.

### `theme.js`

Optional. A single ES module for **progressive enhancement** — motion, and
an optional light/dark preference toggle (see [Dark mode](#dark-mode)).
It's served by Amber's asset route at `/themes/<your-theme>/theme.js` and,
when present, the root layout loads it on public pages as a deferred module
script (`<script type="module">`). Theme discovery records its presence
(`hasScript`); a missing `theme.js` is silent, like an absent `partials/` or
`fonts/`.

The hard contract: the page must be **visually complete and fully
functional with `theme.js` removed**, with JavaScript disabled, and under
`prefers-reduced-motion`. No content, layout, or navigation may depend on
it — it only layers enhancement onto a page that already works. A preference
toggle therefore ships its control `hidden` and reveals it from `theme.js`,
so no-JS visitors never meet a dead button and still get OS-driven theming.
This is the one scripting seam a theme gets; everything structural stays
CSS + HTML.

## Template runtime

Amber renders templates with a ~130-line Mustache subset. No dependencies,
no build step. It does exactly what the two existing themes need.

### Supported syntax

**Variables.** `{{key}}` expands to `data[key]`, HTML-escaped. Unknown
keys render as empty. This matches Svelte's `{expr}` escaping.

```
<a href="/">{{site_title}}</a>
```

**Raw variables.** `{{{key}}}` expands without escaping. Use for trusted
HTML that's already been rendered — `{{{html}}}`, `{{{index_html}}}`,
`{{{body}}}`. This matches Svelte's `{@html expr}`.

```
<div class="article-body">{{{html}}}</div>
```

**Sections.** `{{#key}}…{{/key}}` is conditional or iterative depending on
`data[key]`:

- If `data[key]` is a non-empty array, the block renders **once per
  element**. Inside, each element's own keys are layered over the
  surrounding context — i.e. `{{label}}` inside `{{#nav}}…{{/nav}}` reads
  the current nav entry's `label`, while outer keys like `site_title` are
  still available.
- If `data[key]` is any other truthy value, the block renders once with
  the surrounding context unchanged. (Useful for "render this block iff
  the string is non-empty.")
- If `data[key]` is falsy or an empty array, the block renders nothing.

The chrome's nav loop is the canonical example:

```
{{#nav}}<li><a href="{{href}}">{{label}}</a></li>{{/nav}}
```

**Inverted sections.** `{{^key}}…{{/key}}` renders iff the section would
have rendered nothing — i.e. `data[key]` is falsy or an empty array. The
error template's `{{^is_404}}` branch is the canonical example.

That's everything.

### Not supported

- **Mustache partials (`{{> name}}`).** Amber does not have partial-include
  syntax. The one place a partial is needed today — the auto-index list —
  is rendered separately by the page handler and injected into `page.html`
  as `{{{index_html}}}`. If you need composition beyond that, you don't
  have it; flag the use case.
- **Dotted paths (`{{foo.bar}}`).** Use the variables that are exposed.
- **Lambdas, custom delimiters, helpers.** None of it.

Unknown keys render as empty. Whitespace in the template is preserved
verbatim.

## The `--amber-*` variable surface

`theme.css` defines its tokens as CSS custom properties on `:root` and
consumes them throughout the rest of the stylesheet. `amber-default`
defines 28 `--amber-*` properties. `amber-editorial` declares the same 28
names with different values, plus one theme-local variable
(`--ed-rail-width`) prefixed differently to signal it's not part of the
contract.

The convention is: anything a second theme might plausibly want to change
is an `--amber-*` token; anything purely internal to one theme's layout
uses a theme-local prefix. The contract is a guideline, not enforced — but
following it makes the rest of this document apply.

Below: every `--amber-*` token in `amber-default`, what it's for, the
value `amber-default` sets, and the value `amber-editorial` sets where it
meaningfully differs. The eight tokens marked **★** are the dark-mode
contract (see the next section).

### Color (8 tokens — all dark-mode contract ★)

| Token | Purpose | `amber-default` | `amber-editorial` |
| --- | --- | --- | --- |
| `--amber-bg` ★ | Page background | `#faf7f0` warm paper | `#f4f4f2` cool near-white |
| `--amber-ink` ★ | Primary text | `#2a2622` warm near-black | `#16171a` cool near-black |
| `--amber-ink-muted` ★ | Secondary text — dates, captions, chrome, footer | `#655d4f` | `#57595e` |
| `--amber-accent` ★ | Links, `::marker`, accents | `#9a6314` deep amber | `#1f31d6` electric cobalt |
| `--amber-accent-hover` ★ | Link hover | `#7c4e0f` | `#131f9c` |
| `--amber-rule` ★ | Hairlines — header/footer/article rules, borders | `#e4dcc9` | `#d4d4d0` |
| `--amber-surface-sunken` ★ | Recessed fill — code blocks, inline code | `#efe8d6` | `#e7e8e3` |
| `--amber-selection-bg` ★ | `::selection` highlight | `rgba(154, 99, 20, 0.18)` | `rgba(31, 49, 214, 0.18)` |

### Type (12 tokens)

| Token | Purpose | `amber-default` | `amber-editorial` |
| --- | --- | --- | --- |
| `--amber-font-body` | Body face — the prose | Iowan Old Style / Palatino / Georgia (serif) | Avenir Next / Segoe UI / sans-serif |
| `--amber-font-heading` | Heading face | `var(--amber-font-body)` | Helvetica Neue / Arial (sans-serif) |
| `--amber-font-ui` | Chrome face — nav, dates, footer, captions | `var(--amber-font-body)` | `var(--amber-font-heading)` |
| `--amber-font-mono` | Monospace — code | `ui-monospace`, SF Mono, … | same family with `IBM Plex Mono` added |
| `--amber-text-base` | Root body size | `1.1875rem` (19px) | `1.0625rem` (17px) |
| `--amber-text-sm` | Small chrome text | `0.78rem` | `0.72rem` |
| `--amber-text-h1` | Article title | `2.1rem` | `2.7rem` |
| `--amber-text-h2` | Section heading | `1.4rem` | `1.5rem` |
| `--amber-text-h3` | Sub-heading | `1.15rem` | `1.12rem` |
| `--amber-leading-body` | Body line-height | `1.72` | `1.6` |
| `--amber-leading-tight` | Heading line-height | `1.2` | `1.06` |
| `--amber-tracking-ui` | Letter-spacing for uppercased chrome | `0.085em` | `0.13em` |

### Space and layout (5 tokens)

| Token | Purpose | `amber-default` | `amber-editorial` |
| --- | --- | --- | --- |
| `--amber-measure` | Prose column max-width — ~65–75 characters | `36rem` | `42rem` |
| `--amber-pad-page` | Horizontal padding around the content column | `1.4rem` | `2.75rem` |
| `--amber-gap-flow` | Vertical rhythm between flowing blocks (`p`, `ul`, …) | `1.25rem` | `1rem` |
| `--amber-gap-section` | Extra space above an `h2` | `2.75rem` | `2.4rem` |
| `--amber-gap-chrome` | Gap between header/footer chrome and the content | `2.6rem` | `2.75rem` |

### Shape and motion (3 tokens)

| Token | Purpose | `amber-default` | `amber-editorial` |
| --- | --- | --- | --- |
| `--amber-radius` | Corner radius — code blocks, images | `4px` | `0` (hard edges) |
| `--amber-ease` | Easing for entrances and hovers | `cubic-bezier(0.23, 1, 0.32, 1)` | `cubic-bezier(0.16, 1, 0.3, 1)` |
| `--amber-duration` | Page-entrance duration | `360ms` | `280ms` |

### The contract, restated

Only the 8 color tokens are part of the dark-mode contract. The other 20
are conventions that emerged from one theme and held up against the
second — useful structure for sharing a vocabulary, not a requirement.

A theme that introduces new `--amber-*` names without a second theme
demanding them is overfitting to itself. Use a theme-local prefix instead
(`--ed-rail-width` is `amber-editorial`'s example), and propose contract
additions in a PR when a second theme reuses the same name.

## Dark mode

Light mode defines the base tokens. Dark mode is a `@media (prefers-color-scheme: dark)`
block on `:root` that **remaps the eight color tokens, and nothing else**.
Type, spacing, layout, motion — all mode-agnostic. This is the contract:
themes that want dark mode must honor it. Themes that don't ship a dark
block render in light mode in both contexts (and that is a valid choice).

This is `amber-default`'s entire dark block:

```css
@media (prefers-color-scheme: dark) {
	:root {
		--amber-bg: #1a1714;
		--amber-ink: #e8e0d2;
		--amber-ink-muted: #9a8f7d;
		--amber-accent: #d9a441;
		--amber-accent-hover: #ecbb5e;
		--amber-rule: #332e27;
		--amber-surface-sunken: #232019;
		--amber-selection-bg: rgba(217, 164, 65, 0.22);
	}
}
```

The discipline: every other value in your theme should compose from these
eight (and from the type/space tokens, which don't move between modes).
If a selector in your stylesheet sets a literal color outside the dark
block, you have a bug.

If your theme has a `[theme_color]` table in `theme.toml`, its `light` and
`dark` values should mirror `--amber-bg` in each mode. The browser uses
them to tint its own chrome (Safari address bar, Android status bar) so it
doesn't fight the page.

A theme can add a **manual light/dark toggle** on top of this. Keep the media
block for OS-following (and no-JS), but scope it to `:root:not([data-amber-theme])`
so an explicit choice can win, then add a `:root[data-amber-theme="dark"]` block
with the same dark tokens. A small [`theme.js`](#themejs) control sets that
attribute and stores the choice in `localStorage`; an inline pre-paint script
applies it before the stylesheet so there's no flash. `amber-brand` does exactly
this — a header button that remembers the visitor's choice. The toggle is
enhancement-only: it ships `hidden` and `theme.js` reveals it, so no-JS visitors
still get OS-driven theming. (This stays on the same browser floor as the plain
media-query approach — no `light-dark()` required.)

## One-voice and two-voice typography

The two themes diverge intentionally on font use.

**One voice (`amber-default`).** One family carries the whole interface.
`--amber-font-ui` and `--amber-font-heading` both default to
`var(--amber-font-body)`. The chrome reads as part of the same document.

**Two voices (`amber-editorial`).** A grotesque for chrome and headings, a
humanist sans for body. `--amber-font-ui` and `--amber-font-heading` are
distinct from `--amber-font-body`. The chrome reads as editorial
furniture; the prose reads as voice.

Both are valid. One-voice reads as unified and quiet. Two-voice reads as
editorial and structured. Theme authors decide; the contract just exposes
the seams. The pattern to copy from `amber-default` is:

```css
--amber-font-body: 'Iowan Old Style', /* … */ serif;
--amber-font-heading: var(--amber-font-body);
--amber-font-ui: var(--amber-font-body);
```

The pattern to copy from `amber-editorial` is:

```css
--amber-font-body: 'Avenir Next', /* … */ sans-serif;
--amber-font-heading: 'Helvetica Neue', /* … */ sans-serif;
--amber-font-ui: var(--amber-font-heading);
```

Themes default to system font stacks — a self-hosted canvas shouldn't phone
a font CDN on every page load. A *brand* theme is the exception: it may
`@font-face` self-hosted faces, keeping the bytes on your own server rather
than a CDN. Two serving paths exist: install-wide faces shared across themes
live under the app's static `/fonts/` (e.g. `/fonts/Fraunces.woff2` — this is
what Amber's own brand theme uses); a theme that ships its *own* faces puts
them in `themes/<your-theme>/fonts/`, served verbatim at
`/themes/<your-theme>/fonts/…` by the asset route.

## Auto-index and partials

`auto_index` is a frontmatter directive a page declares to list other
pages in a directory. The content-author reference (what `path` /
`sort` / `limit` accept, what gets filtered, what shows up in the log
when it goes wrong) lives in [`auto-index.md`](auto-index.md); the
theming surface is:

1. A page declares `auto_index` in its frontmatter:

   ```yaml
   ---
   title: Writing
   auto_index:
     path: writing
     sort: date desc
     limit: 20
   ---
   ```

2. At render time, Amber resolves the list against the *live* page set
   (so it reflects watcher updates, not just load-time state), excluding
   the host page, drafts, and anything outside `path`. The result is
   sorted and capped.

3. Amber renders your theme's `partials/index.html` with one variable —
   `index_entries`, an array of objects — and substitutes the rendered
   HTML into `page.html` as `{{{index_html}}}`.

Each entry has this shape:

```js
{
  href:    "/writing/2026-04-22-quiet",  // absolute path under the space
  title:   "Quiet",                      // frontmatter title, falling back to href
  date:    "2026-04-22",                 // frontmatter date, or null
  updated: "2026-04-30"                  // frontmatter updated, or null
}
```

`amber-default`'s partial:

```html
<ul class="amber-auto-index">
	{{#index_entries}}
	<li class="amber-auto-index-item">
		<a class="amber-auto-index-link" href="{{href}}">{{title}}</a>
		{{#date}}<time class="amber-auto-index-date" datetime="{{date}}">{{date}}</time>{{/date}}
	</li>
	{{/index_entries}}
</ul>
```

`amber-editorial`'s partial is the same shape with `<ol>` instead of
`<ul>` — the numbered-counter look is achieved entirely in CSS via
`counter-reset` on the list element.

If you don't ship `partials/index.html`, Amber falls back to a minimal
built-in partial. Override it when you want to: control the markup
(say, render `updated` instead of `date`), restyle without fighting
specificity, or use a different element. The `auto_index` system has
exactly one partial slot; there's no other partial extensibility today.

## What a theme is NOT responsible for

These belong to Amber, not the theme. Don't try to override them.

- **The `<main>` landmark.** Amber wraps the page content in `<main>` in
  the root layout. Your chrome must not contain one; your page template
  must not be wrapped in one.
- **Routing.** URL resolution, redirects, 404 logic, draft visibility are
  all app concerns. The theme receives variables; it doesn't decide what
  page is rendered.
- **Markdown rendering.** Markdown → HTML happens before your template
  runs. You receive `{{{html}}}`; you do not parse markdown.
- **Page logic.** Content, layout, and navigation are CSS + HTML only.
  There is no template-level scripting hook. Reach for CSS first
  (`amber-default`'s entrance animation and `amber-editorial`'s cobalt rule
  draw-in are both pure-CSS). The one exception is an optional `theme.js`
  for *progressive-enhancement motion* — see [`theme.js`](#themejs) — which
  may never carry anything the page needs to work.
- **Build steps.** Themes are plain files. No bundler, no preprocessor.

## Installing and selecting a theme

1. Put your theme directory at `spaces/<space>/themes/<your-theme>/`.
2. In that space's `space.toml`, set:

   ```toml
   theme = "your-theme"
   ```

3. Or, to make it the install-level default for any space that hasn't
   picked one of its own, set it in `amber.toml`:

   ```toml
   theme = "your-theme"
   ```

Resolution order, per space:

1. The space's own `space.toml` `theme` field.
2. The install's `amber.toml` `theme` field.
3. `amber-default` if discovered.
4. A built-in unstyled floor.

Changes to `space.toml` are hot-reloaded — save and refresh.
Changes to `amber.toml` require a server restart. Theme directories
themselves are discovered once at cold start; adding a new theme
directory requires restart, but editing files *within* an existing
theme's directory (CSS, templates, fonts) is picked up on the next
request without restart, because templates are read from disk per
request and the CSS is served as a regular asset.

## A tour of the two themes

Pointers into the source. Both themes share the same vocabulary; they
diverge on every value and on the typographic decisions.

**The token blocks.** Both stylesheets open with a single `:root` block
laid out in the same four sections (color, type, space, motion) in the
same order. Compare them side by side:

- [`amber-default/theme.css`](../spaces/avp-software/themes/amber-default/theme.css) lines 17–61.
- [`amber-editorial/theme.css`](../spaces/avp-software/themes/amber-editorial/theme.css) lines 29–84. The trailing `--ed-rail-width` is the theme-local exception — note the comment explaining why it isn't `--amber-*`.

**The dark blocks.** Both immediately after the `:root` block:

- [`amber-default/theme.css`](../spaces/avp-software/themes/amber-default/theme.css) lines 63–77.
- [`amber-editorial/theme.css`](../spaces/avp-software/themes/amber-editorial/theme.css) lines 86–100.

The eight tokens line up one-for-one in both. That's the contract.

**The chrome.** Both `chrome.html` files are byte-for-byte identical — the
markup is the same; the layout (centered column vs. sidebar rail) is
entirely a stylesheet decision. Compare:

- [`amber-default/chrome.html`](../spaces/avp-software/themes/amber-default/chrome.html) — the markup.
- [`amber-default/theme.css`](../spaces/avp-software/themes/amber-default/theme.css) lines 109–156 — the centered-column treatment.
- [`amber-editorial/theme.css`](../spaces/avp-software/themes/amber-editorial/theme.css) lines 125–207 — the sidebar-rail treatment, plus the
  responsive collapse at the bottom of the file (lines 604–662).

**The page template.** One small difference: the editorial template puts
the date *above* the title; the default puts the title above the date.
That's a template-level decision, not a stylesheet one.

- [`amber-default/page.html`](../spaces/avp-software/themes/amber-default/page.html).
- [`amber-editorial/page.html`](../spaces/avp-software/themes/amber-editorial/page.html).

**The auto-index partial.** Same data, different markup choice (`<ul>`
vs. `<ol>`), and very different visual treatment.

- [`amber-default/partials/index.html`](../spaces/avp-software/themes/amber-default/partials/index.html).
- [`amber-editorial/partials/index.html`](../spaces/avp-software/themes/amber-editorial/partials/index.html).
- The editorial number-counter treatment lives in
  [`amber-editorial/theme.css`](../spaces/avp-software/themes/amber-editorial/theme.css) lines 432–487 — CSS counters
  on the list element, no markup change needed.

**The error template.** `amber-default` keeps it minimal; `amber-editorial`
adds a small `.error-page` wrapper so it can be styled distinctly.

- [`amber-default/error.html`](../spaces/avp-software/themes/amber-default/error.html).
- [`amber-editorial/error.html`](../spaces/avp-software/themes/amber-editorial/error.html).

**Entrance animation.** Both themes ship a single one-off entrance and
nothing else. Same shape: a `prefers-reduced-motion: no-preference` guard,
one keyframe, applied to the article header and body with a small delay.

- [`amber-default/theme.css`](../spaces/avp-software/themes/amber-default/theme.css) lines 407–427.
- [`amber-editorial/theme.css`](../spaces/avp-software/themes/amber-editorial/theme.css) lines 565–600 — adds the cobalt rule draw-in.

If you want a starting point for your own theme, copy `amber-default`'s
directory wholesale, rename it, and start changing values.
