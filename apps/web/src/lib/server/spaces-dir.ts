/**
 * `AMBER_SPACES_DIR` discovery (spec §5). Lists immediate subdirectories of
 * the spaces parent, validates each directory name against the slug regex,
 * and skips any subdir without an `amber.toml` (silent, matches the
 * existing reserved-prefix scan behavior).
 *
 * Pure-ish: filesystem reads only. No registry side effects. The caller
 * (`hooks.server.ts`) passes each returned path to `getSpace(spacePath)`
 * to load it into the registry.
 *
 * Symlinks: spec §5.1 — call `statSync` (follows symlinks) on each entry,
 * so an operator can symlink in spaces from another volume.
 */

import { readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import type { LoadWarning } from '$lib/types/schema';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function isValidSlug(name: string): boolean {
	return SLUG_RE.test(name);
}

export interface DiscoveredSpace {
	slug: string;
	absPath: string;
}

export interface DiscoveryResult {
	entries: DiscoveredSpace[];
	warnings: LoadWarning[];
}

export function discoverSpaces(spacesDir: string): DiscoveryResult {
	const absParent = path.resolve(spacesDir);
	const warnings: LoadWarning[] = [];
	const entries: DiscoveredSpace[] = [];

	let names: string[];
	try {
		names = readdirSync(absParent);
	} catch (err) {
		throw new Error(
			`AMBER_SPACES_DIR is set to "${spacesDir}" but the directory could not be read: ${
				err instanceof Error ? err.message : String(err)
			}`
		);
	}

	for (const name of names) {
		const childAbs = path.join(absParent, name);
		let s;
		try {
			s = statSync(childAbs); // follows symlinks per spec §5.1
		} catch (err) {
			// Broken symlinks, permission errors, transient I/O. Skip the entry
			// (the rest of the directory still loads) but surface the failure —
			// silent drops make "where did my space go?" unanswerable.
			warnings.push({
				code: 'space_dir_stat_failed',
				message: `could not stat "${name}" under AMBER_SPACES_DIR; the entry is skipped (${
					err instanceof Error ? err.message : String(err)
				})`,
				source: name
			});
			continue;
		}
		if (!s.isDirectory()) continue;
		if (!existsSync(path.join(childAbs, 'amber.toml'))) continue;

		if (!isValidSlug(name)) {
			warnings.push({
				code: 'space_routing_invalid_slug',
				message: `directory name "${name}" does not match ${SLUG_RE.source}; this space is dropped entirely (no slug → no admin URL → no way to reach it). Rename the directory to fix.`,
				source: name
			});
			continue;
		}

		entries.push({ slug: name, absPath: childAbs });
	}

	// Stable order for deterministic "first-loaded wins" conflict resolution.
	entries.sort((a, b) => a.slug.localeCompare(b.slug));
	return { entries, warnings };
}
