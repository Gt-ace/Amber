/**
 * Minimal Mustache-subset renderer for theme templates.
 *
 * This is deliberately tiny — themes are "vanilla HTML, no build step" the same
 * way theme CSS is "vanilla CSS, no build step" (SPIKE_NOTES). It is *not* a
 * general templating engine; it does exactly what the amber-default templates
 * need:
 *
 *   {{ key }}            HTML-escaped value (matches Svelte's `{expr}` escaping)
 *   {{{ key }}}          raw value, no escaping (matches Svelte's `{@html expr}`)
 *   {{# key }} … {{/ key }}   section: if `data[key]` is a non-empty array,
 *                              render the inner block once per element with the
 *                              element's own keys layered over the surrounding
 *                              context; if it is any other truthy value, render
 *                              the inner block once with the surrounding
 *                              context; if falsy or an empty array, render
 *                              nothing.
 *   {{^ key }} … {{/ key }}   inverted section: render the inner block iff the
 *                              section would have rendered nothing.
 *
 * Unknown keys render as empty. Whitespace is preserved verbatim. No partials,
 * no dotted paths, no helpers — add them when a theme actually needs them.
 *
 * Universal module (no node imports): `+error.svelte` renders the error
 * template on the client.
 */

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

/**
 * The chrome template's content slot. A literal HTML comment, not a `{{ }}`
 * tag: the renderer's tag regex never matches comments, and `{{var}}`
 * substitution escapes `<`/`>`, so nothing a theme or `amber.toml` author can
 * write produces this exact string by accident. `+layout.server.ts` renders
 * the chrome template (which contains this marker verbatim, once) and splits
 * the result on it into `chromeBefore` / `chromeAfter`.
 */
export const CONTENT_SLOT = '<!--amber:content-->';

type Context = Record<string, unknown>;

function stringify(value: unknown): string {
	if (value == null) return '';
	return String(value);
}

function isTruthy(value: unknown): boolean {
	if (Array.isArray(value)) return value.length > 0;
	return Boolean(value);
}

// Token = a literal chunk or a tag. We parse into a tree so sections nest.
type Node =
	| { kind: 'text'; value: string }
	| { kind: 'var'; key: string; raw: boolean }
	| { kind: 'section'; key: string; inverted: boolean; children: Node[] };

const TAG = /\{\{(\{)?\s*([#^/]?)\s*([\w-]+)\s*\}?\}\}/g;

function parse(template: string): Node[] {
	const root: Node[] = [];
	const stack: { key: string; nodes: Node[] }[] = [];
	let here: Node[] = root;
	let last = 0;
	TAG.lastIndex = 0;
	let m: RegExpExecArray | null;
	while ((m = TAG.exec(template)) !== null) {
		if (m.index > last) here.push({ kind: 'text', value: template.slice(last, m.index) });
		last = TAG.lastIndex;
		const tripleOpen = m[1] === '{';
		const sigil = m[2];
		const key = m[3];
		if (sigil === '#' || sigil === '^') {
			const node: Node = { kind: 'section', key, inverted: sigil === '^', children: [] };
			here.push(node);
			stack.push({ key, nodes: here });
			here = node.children;
		} else if (sigil === '/') {
			const open = stack.pop();
			if (!open || open.key !== key) {
				throw new Error(`renderTemplate: mismatched section close {{/${key}}}`);
			}
			here = open.nodes;
		} else {
			// Plain {{var}} or {{{var}}}. A trailing `}` after the key in the
			// triple form is consumed by the regex's optional `\}?`.
			here.push({ kind: 'var', key, raw: tripleOpen });
		}
	}
	if (stack.length) throw new Error(`renderTemplate: unclosed section {{#${stack[0].key}}}`);
	if (last < template.length) here.push({ kind: 'text', value: template.slice(last) });
	return root;
}

function renderNodes(nodes: Node[], context: Context): string {
	let out = '';
	for (const node of nodes) {
		if (node.kind === 'text') {
			out += node.value;
		} else if (node.kind === 'var') {
			const v = stringify(context[node.key]);
			out += node.raw ? v : escapeHtml(v);
		} else {
			const value = context[node.key];
			const truthy = isTruthy(value);
			if (node.inverted) {
				if (!truthy) out += renderNodes(node.children, context);
			} else if (Array.isArray(value)) {
				for (const item of value) {
					const child: Context =
						item && typeof item === 'object' && !Array.isArray(item)
							? { ...context, ...(item as Context) }
							: { ...context };
					out += renderNodes(node.children, child);
				}
			} else if (truthy) {
				out += renderNodes(node.children, context);
			}
		}
	}
	return out;
}

export function renderTemplate(template: string, data: Context): string {
	return renderNodes(parse(template), data);
}
