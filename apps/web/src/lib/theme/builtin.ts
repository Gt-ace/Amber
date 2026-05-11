/**
 * The built-in fallback theme.
 *
 * Used only when neither the configured theme nor `amber-default` is a usable
 * discovered theme under `<space>/themes/` — i.e. a misconfigured space, or a
 * test fixture with no `themes/` directory. Deliberately unstyled: it renders
 * semantic HTML and emits no stylesheet `<link>` (its `assetBase` is `''`).
 * The real default lives at `spaces/avp-software/themes/amber-default/`.
 *
 * Its templates use the same Mustache-subset contract the discovered themes do
 * (see `lib/render/template.ts`), so the route renders it through exactly the
 * same code path. The chrome's content slot is `CONTENT_SLOT` (the literal
 * HTML comment `<!--amber:content-->`) — the layout splits the rendered chrome
 * there.
 *
 * `readTemplate(theme, kind)` returns these strings when `theme.path === ''`.
 */

import { CONTENT_SLOT } from '$lib/render/template';

export const BUILTIN_TEMPLATES: Record<'chrome' | 'page' | 'error', string> = {
	chrome: `<header class="site-header">
{{#site_title}}<a href="/" class="site-title">{{site_title}}</a>{{/site_title}}
{{#has_nav}}<nav class="site-nav" aria-label="Primary"><ul>{{#nav}}<li><a href="{{href}}">{{label}}</a></li>{{/nav}}</ul></nav>{{/has_nav}}
</header>
<main>${CONTENT_SLOT}</main>
<footer class="site-footer"><span>{{site_title_or_default}}</span>{{#footer_href}}<a href="{{footer_href}}">{{footer_label}}</a>{{/footer_href}}</footer>
`,
	page: `{{#is_draft}}<p class="draft-banner" role="status">Draft — visible in development only. This page returns 404 in production.</p>{{/is_draft}}
<article>
{{#has_header}}<header class="article-header">{{#title}}<h1 class="article-title">{{title}}</h1>{{/title}}{{#date_display}}<p class="article-date"><time datetime="{{date_iso}}">{{date_display}}</time></p>{{/date_display}}</header>{{/has_header}}
<div class="article-body">{{{html}}}</div>
</article>
`,
	error: `{{#is_404}}{{#has_body}}{{{body}}}{{/has_body}}{{^has_body}}<h1>Page not found</h1><p>The page you were looking for doesn't exist.</p><p><a href="/">Back to home</a></p>{{/has_body}}{{/is_404}}{{^is_404}}<h1>{{status}}</h1><p>{{message}}</p><p><a href="/">Back to home</a></p>{{/is_404}}
`
};

export const BUILTIN_THEME: import('$lib/types/schema').Theme = {
	name: 'amber-default',
	path: '',
	assetBase: '',
	manifest: { name: 'Amber (built-in fallback)' }
};
