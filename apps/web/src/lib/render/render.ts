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
 *   - `breaks: true` — single newlines inside paragraphs render as `<br>`.
 *     The convention authors should follow is "don't soft-wrap inside
 *     paragraphs": one logical paragraph is one long line. With this flag,
 *     a hand-typed line break is intentional and shows up as a break;
 *     accidental editor-driven wrapping becomes visible immediately and
 *     gets fixed at the source rather than papered over by the renderer.
 *
 * Plugins (footnotes, anchors, syntax highlighting) deliberately not added
 * here — that's a later sprint.
 */

import MarkdownIt from 'markdown-it';

const md = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: false,
	breaks: true
});

export function render(markdown: string): string {
	return md.render(markdown);
}
