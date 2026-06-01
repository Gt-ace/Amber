/**
 * Updates a space's `space.toml` to a desired *final state* (spec §4,
 * subsystem 6). Canonical re-serialize: the caller passes the fields it
 * wants on disk; the writer emits the four known keys in fixed order and
 * drops everything else (comments, unknown keys). On an empty update the
 * file is deleted — the canonical "no overrides" representation.
 *
 * Pure I/O. It does not read the current file, validate the theme, or
 * touch the registry. The watcher reacts to the on-disk change
 * (`space_config_change` → `Space.applySpaceConfigChange`), so the writer
 * never calls `space.apply` itself.
 *
 * Atomic via tmp-then-rename so a watcher flush mid-write never sees a
 * half-written file. The tmp name starts with `.` so it isn't a content
 * file, and carries pid + counter so two concurrent writers don't collide.
 */

import { writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { escapeTomlBasic } from './toml-escape';

export type WriteConfigErrorCode = 'permission_denied' | 'write_failed';

export interface SpaceConfigUpdate {
	host?: string;
	prefix?: string;
	default?: boolean;
	theme?: string;
}

export type WriteSpaceConfigResult =
	| { kind: 'ok' }
	| { kind: 'error'; code: WriteConfigErrorCode; detail?: string };

let tmpCounter = 0;

/** Lines in fixed key order; present iff the field is set on `update`. */
function serialize(update: SpaceConfigUpdate): string {
	const lines: string[] = [];
	if (update.host !== undefined) lines.push(`host = "${escapeTomlBasic(update.host)}"`);
	if (update.prefix !== undefined) lines.push(`prefix = "${escapeTomlBasic(update.prefix)}"`);
	if (update.default === true) lines.push('default = true');
	if (update.theme !== undefined) lines.push(`theme = "${escapeTomlBasic(update.theme)}"`);
	return lines.length === 0 ? '' : lines.join('\n') + '\n';
}

function classifyError(err: unknown): WriteConfigErrorCode {
	const e = err as NodeJS.ErrnoException;
	if (e?.code === 'EACCES' || e?.code === 'EPERM') return 'permission_denied';
	return 'write_failed';
}

export async function writeSpaceConfig(
	spaceRoot: string,
	update: SpaceConfigUpdate
): Promise<WriteSpaceConfigResult> {
	const content = serialize(update);
	const final = join(spaceRoot, 'space.toml');

	// Empty update → delete space.toml (canonical "no overrides"). A missing
	// file is already the desired state (ENOENT swallowed).
	if (content === '') {
		try {
			await unlink(final);
		} catch (err) {
			const e = err as NodeJS.ErrnoException;
			if (e?.code === 'ENOENT') return { kind: 'ok' };
			return { kind: 'error', code: classifyError(err), detail: (err as Error)?.message };
		}
		return { kind: 'ok' };
	}

	const tmp = join(spaceRoot, `.space.toml.tmp.${process.pid}.${tmpCounter++}`);
	try {
		await writeFile(tmp, content, { encoding: 'utf8', mode: 0o644 });
		await rename(tmp, final);
		return { kind: 'ok' };
	} catch (err) {
		await unlink(tmp).catch(() => {}); // best-effort cleanup; swallow
		return { kind: 'error', code: classifyError(err), detail: (err as Error)?.message };
	}
}
