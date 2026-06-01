/**
 * TOML basic-string escape. Covers the characters that break smol-toml's
 * parser inside a `"..."` value: the quote, the backslash, the three named
 * whitespace escapes, and the remaining control chars as `\uXXXX`.
 *
 * Extracted verbatim from `space-create.ts` (v0.5 subsystem 6) so the
 * space-creation writer and the theme-picker writer share one
 * implementation. The escape set and its tests are the contract; don't
 * "simplify" it without re-running both writers' round-trip fuzz tests.
 */
export function escapeTomlBasic(s: string): string {
	let out = '';
	for (const ch of s) {
		const code = ch.codePointAt(0)!;
		if (ch === '"') out += '\\"';
		else if (ch === '\\') out += '\\\\';
		else if (ch === '\n') out += '\\n';
		else if (ch === '\r') out += '\\r';
		else if (ch === '\t') out += '\\t';
		else if (code < 0x20 || code === 0x7f) {
			out += '\\u' + code.toString(16).padStart(4, '0');
		} else {
			out += ch;
		}
	}
	return out;
}
