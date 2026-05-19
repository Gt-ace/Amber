/**
 * Pure helpers for the in-browser editor's save path. No I/O, no globals —
 * unit-tested in isolation (see editor.test.ts). The route handlers
 * (admin/api/page, admin/edit) do the reading and writing; this module only
 * transforms strings.
 */

import { createHash } from 'node:crypto';
import { stringify as stringifyYaml } from 'yaml';
import { FRONTMATTER_BLOCK_RE } from '$lib/space/load';

/** SHA-256 hex of a UTF-8 string. The whole-file hash used for `If-Match`. */
export function hashContent(raw: string): string {
	return createHash('sha256').update(raw, 'utf8').digest('hex');
}

/**
 * Split a raw file into its verbatim frontmatter block and body, WITHOUT
 * normalizing either. `fmBlock` is the exact bytes the loader's regex matched
 * (delimiters + closing newline) or `''` when the file has no frontmatter.
 * `fmInner` is the inner YAML (regex group 1). `body` is everything after
 * `fmBlock`. Verbatim so a body-only save can re-prepend the block byte-for-byte.
 */
export function splitRaw(raw: string): { fmBlock: string; fmInner: string; body: string } {
	const match = FRONTMATTER_BLOCK_RE.exec(raw);
	if (!match) return { fmBlock: '', fmInner: '', body: raw };
	return { fmBlock: match[0], fmInner: match[1], body: raw.slice(match[0].length) };
}

/**
 * Recombine a frontmatter block and a body. Guarantees exactly one `\n`
 * between the closing `---` and the first byte of the body (spec §3): leading
 * newlines are stripped from the body and the block is normalized to a single
 * trailing newline. With an empty block the body is returned unchanged.
 */
export function recombine(fmBlock: string, body: string): string {
	const cleanBody = body.replace(/^\n+/, '');
	if (fmBlock === '') return cleanBody;
	const block = fmBlock.replace(/\n*$/, '\n');
	return block + cleanBody;
}

/** The three frontmatter fields the editor panel may change (spec §3). */
export interface EditableFrontmatter {
	title?: string;
	draft?: boolean;
	date?: string;
}

/**
 * Apply the editable fields over a COMPLETE parsed frontmatter mapping and
 * re-serialize to a fresh `---\n...\n---\n` block. `parsed` is every key from
 * the on-disk YAML (known + extra together) — every key not named in `edits`
 * passes through untouched (spec §3). This reformats the YAML: comments and
 * key order are not preserved, by design. `title`/`date` set to `''` clear the
 * key; `draft: false` omits the key; `draft: true` writes it.
 */
export function reserializeFrontmatter(
	parsed: Record<string, unknown>,
	edits: EditableFrontmatter
): string {
	const merged: Record<string, unknown> = { ...parsed };
	if (edits.title !== undefined) {
		if (edits.title === '') delete merged.title;
		else merged.title = edits.title;
	}
	if (edits.date !== undefined) {
		if (edits.date === '') delete merged.date;
		else merged.date = edits.date;
	}
	if (edits.draft !== undefined) {
		if (edits.draft) merged.draft = true;
		else delete merged.draft;
	}
	const yaml = stringifyYaml(merged);
	return `---\n${yaml.endsWith('\n') ? yaml : yaml + '\n'}---\n`;
}
