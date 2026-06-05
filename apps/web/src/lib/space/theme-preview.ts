/**
 * Build a self-contained HTML preview document for a theme — used by the
 * theme-picker UI (`/admin/spaces/[slug]/theme`) to show a live mini-render of
 * each theme in a sandboxed `<iframe srcdoc>` before the operator commits.
 *
 * The preview is assembled with the *same* primitives the real render path
 * uses — `readTemplate` for the theme's `chrome.html` / `page.html`,
 * `renderTemplate` for the moustache substitution, and the markdown `render`
 * for the sample body — so it shows the theme's true fonts, colours, headings,
 * links and code, not an approximation. The only inputs are fixed sample data;
 * no `Space` or `Page` is involved, so it's a pure function of the theme.
 *
 * The theme's stylesheet is linked (versioned) via `opts.cssHref`; pass `null`
 * to omit it (the built-in floor theme has no on-disk CSS asset, so its preview
 * renders unstyled — acceptable; it is the floor). The preview never loads the
 * theme's `theme.js`: previews are inert, and the iframe is sandboxed without
 * `allow-scripts` regardless.
 */

import { readTemplate, type TemplateKind } from './themes.ts';
import { renderTemplate, CONTENT_SLOT } from '$lib/render/template';
import { render } from '$lib/render/render';
import type { Theme } from '$lib/types/schema';

/** Representative content that exercises the type scale and the accent colour. */
const SAMPLE_TITLE = 'The quick brown fox';
const SAMPLE_MARKDOWN = `A short paragraph of body copy with a [link](#) and some
\`inline code\`, so you can read the theme's body font and accent colour.

## A subheading

- First list item
- Second list item

> A blockquote, for the muted voice.`;

const SAMPLE_NAV = [
	{ href: '#', label: 'Home' },
	{ href: '#', label: 'About' },
	{ href: '#', label: 'Notes' }
];

function readTemplateOrEmpty(theme: Theme, kind: TemplateKind): string {
	try {
		return readTemplate(theme, kind);
	} catch {
		return '';
	}
}

export function buildThemePreview(theme: Theme, opts: { cssHref: string | null }): string {
	// Chrome, split at the content marker exactly like +layout.server.ts.
	const chromeRendered = renderTemplate(readTemplateOrEmpty(theme, 'chrome'), {
		site_title: 'Your Space',
		site_title_or_default: 'Your Space',
		has_nav: true,
		nav: SAMPLE_NAV,
		footer_label: '',
		footer_href: ''
	});
	const slot = chromeRendered.indexOf(CONTENT_SLOT);
	const chromeBefore = slot === -1 ? chromeRendered : chromeRendered.slice(0, slot);
	const chromeAfter = slot === -1 ? '' : chromeRendered.slice(slot + CONTENT_SLOT.length);

	// Page body, through page.html with the same data shape as render/page.ts.
	const pageBody = renderTemplate(readTemplateOrEmpty(theme, 'page'), {
		is_draft: false,
		has_header: true,
		is_home: false,
		title: SAMPLE_TITLE,
		date_iso: '',
		date_display: '',
		html: render(SAMPLE_MARKDOWN),
		index_html: ''
	});

	const styleLink = opts.cssHref ? `<link rel="stylesheet" href="${opts.cssHref}" />` : '';

	return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${styleLink}
</head>
<body>
${chromeBefore}
<main>
${pageBody}
</main>
${chromeAfter}
</body>
</html>`;
}
