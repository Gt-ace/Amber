/**
 * `space.toml` loader. Optional per-space config file at the space root.
 *
 * Schema (v0.3 P1):
 *   theme = "<name>"   # name of a theme directory under `<space>/themes/`
 *
 * Schema (v0.5 subsystem 3 — multi-space routing):
 *   host    = "<bare host>"   # exact-match host (e.g. "amber.example.com"); mutually exclusive with `prefix`.
 *   prefix  = "/<segment>"    # URL prefix (e.g. "/scratch"); mutually exclusive with `host`.
 *   default = true|false      # at most one space across the runtime may set this.
 *
 * Filesystem is truth, manifest is authoritative — `space.toml` is read,
 * never rewritten. Missing file is the documented no-op. Invalid content
 * (parse failure, non-table top level, non-string `theme`) emits a
 * `space_config_invalid` warning and the resolver falls through; the space
 * still loads. The routing fields are parsed here as raw primitives only —
 * leading-slash / wildcard / host-shape validation lives in the routing
 * subsystem, not this loader.
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
	/** Exact-match host (e.g. "amber.example.com"). Mutually exclusive with `prefix`. */
	host?: string;
	/** URL prefix (e.g. "/scratch"). Mutually exclusive with `host`. */
	prefix?: string;
	/** At most one space across the runtime may set `default = true`. */
	default?: boolean;
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

	if ('host' in obj && obj.host !== undefined) {
		if (typeof obj.host === 'string') {
			config.host = obj.host;
		} else {
			warnings.push({
				code: 'space_config_invalid',
				message: `space.toml \`host\` must be a string, got ${typeof obj.host}`,
				source: 'space.toml'
			});
		}
	}

	if ('prefix' in obj && obj.prefix !== undefined) {
		if (typeof obj.prefix === 'string') {
			config.prefix = obj.prefix;
		} else {
			warnings.push({
				code: 'space_config_invalid',
				message: `space.toml \`prefix\` must be a string, got ${typeof obj.prefix}`,
				source: 'space.toml'
			});
		}
	}

	if ('default' in obj && obj.default !== undefined) {
		if (typeof obj.default === 'boolean') {
			config.default = obj.default;
		} else {
			warnings.push({
				code: 'space_config_invalid',
				message: `space.toml \`default\` must be a boolean, got ${typeof obj.default}`,
				source: 'space.toml'
			});
		}
	}

	return { config, warnings };
}
