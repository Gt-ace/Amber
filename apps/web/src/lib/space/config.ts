/**
 * `space.toml` loader. Optional per-space config file at the space root.
 *
 * Schema (v0.3 P1):
 *   theme = "<name>"   # name of a theme directory under `<space>/themes/`
 *
 * Filesystem is truth, manifest is authoritative — `space.toml` is read,
 * never rewritten. Missing file is the documented no-op. Invalid content
 * (parse failure, non-table top level, non-string `theme`) emits a
 * `space_config_invalid` warning and the resolver falls through; the space
 * still loads.
 *
 * Extra keys are accepted and ignored (forward-compat with later fields).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseToml } from 'smol-toml';

import type { LoadWarning } from '$lib/types/schema';

export interface SpaceConfig {
	/** Name of a theme directory under `<space>/themes/`. */
	theme?: string;
}

export function readSpaceConfig(spaceRoot: string): {
	config: SpaceConfig | null;
	warnings: LoadWarning[];
} {
	const path = join(spaceRoot, 'space.toml');
	let raw: string;
	try {
		raw = readFileSync(path, 'utf8');
	} catch {
		return { config: null, warnings: [] };
	}

	let parsed: unknown;
	try {
		parsed = parseToml(raw);
	} catch (err) {
		return {
			config: null,
			warnings: [
				{
					code: 'space_config_invalid',
					message: `space.toml failed to parse: ${err instanceof Error ? err.message : String(err)}`,
					source: 'space.toml'
				}
			]
		};
	}

	if (parsed == null) {
		return { config: {}, warnings: [] };
	}

	if (typeof parsed !== 'object' || Array.isArray(parsed)) {
		return {
			config: null,
			warnings: [
				{
					code: 'space_config_invalid',
					message: 'space.toml must be a table at the top level',
					source: 'space.toml'
				}
			]
		};
	}

	const obj = parsed as Record<string, unknown>;
	const config: SpaceConfig = {};
	const warnings: LoadWarning[] = [];

	if ('theme' in obj && obj.theme !== undefined) {
		if (typeof obj.theme === 'string') {
			config.theme = obj.theme;
		} else {
			warnings.push({
				code: 'space_config_invalid',
				message: `space.toml \`theme\` must be a string, got ${typeof obj.theme}`,
				source: 'space.toml'
			});
		}
	}

	return { config, warnings };
}
