/**
 * Pure validator for the theme-picker form (spec §6). The submitted radio
 * value is either '' (the "use install default" sentinel → theme omitted from
 * the write) or a theme name that must be in the live discovered set. Anything
 * else is `theme_not_discovered` — re-rendered into the form, never written.
 *
 * Theme-name *shape* isn't separately validated: discovery already constrains
 * names (no leading `.`/`_`, parseable theme.toml, three required templates),
 * so membership in the discovered map is the only check.
 */

import type { Theme } from '$lib/types/schema';

export type ThemePickErrorCode = 'theme_not_discovered';

export type ValidateThemePickResult =
	| { kind: 'ok'; theme: string | undefined }
	| { kind: 'error'; code: ThemePickErrorCode; submitted: string };

export function validateThemePick(
	submitted: string,
	discovered: Map<string, Theme>
): ValidateThemePickResult {
	if (submitted === '') return { kind: 'ok', theme: undefined };
	if (discovered.has(submitted)) return { kind: 'ok', theme: submitted };
	return { kind: 'error', code: 'theme_not_discovered', submitted };
}
