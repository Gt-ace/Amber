/**
 * Pure markdown → HTML renderer.
 *
 * No I/O, no caching, no Space awareness. Given the same string in, the same
 * string comes out — that determinism is what makes the content-hash-keyed
 * render cache (`./cache.ts`) viable.
 *
 * Configuration is intentionally minimal:
 *   - `html: false` — raw HTML in markdown is escaped, not passed through.
 *     Source markdown is the operator's own files, but escaping raw HTML
 *     guards against accidents (a stray `<script>` in a paste, an unclosed
 *     tag) and removes a sanitization decision we don't need this sprint.
 *   - `linkify: true` — bare URLs auto-link.
 *   - `typographer: false` — no smart quotes, no ellipsis transforms. Output
 *     stays a deterministic function of input bytes; locale-dependent
 *     transforms would couple cache hits to environment.
 *
 * Plugins (footnotes, anchors, syntax highlighting) deliberately not added
 * here — that's a later sprint.
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: false
});

export function render(markdown: string): string {
	return md.render(markdown);
}
