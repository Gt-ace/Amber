/**
 * Writes a new space directory tree under AMBER_SPACES_DIR. Atomic-ish:
 * mkdir { recursive: false } first (fails fast if the target exists),
 * then writes amber.toml, optional space.toml, and a scaffolded
 * index.md inside a try block. Any failure during the writes
 * triggers a `rm -rf` of the partial directory.
 *
 * Pure I/O — does not touch the registry or the resolver index. The
 * caller (/admin/new-space's action) calls `addSpace()` separately on
 * success.
 *
 * Per spec §4.
 */

import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { ValidatedCreateInput } from './space-create-validate';
import { escapeTomlBasic } from './toml-escape';

export type WriteErrorCode = 'dir_already_exists' | 'write_failed' | 'permission_denied';

export type CreateSpaceResult =
	| { kind: 'ok'; absPath: string }
	| { kind: 'error'; code: WriteErrorCode; detail?: string };

interface CreateSpaceArgs {
	parentDir: string;
	input: ValidatedCreateInput;
	/**
	 * Test-only hook. When set, the writer throws after the named step,
	 * letting tests exercise the rollback path without mocking fs.
	 * Production callers never pass this.
	 */
	__forceFailAfter?: 'mkdir' | 'amber' | 'space' | 'index';
}


function amberToml(title: string): string {
	return `amber_version = "0.1"\n\n[site]\ntitle = "${escapeTomlBasic(title)}"\n`;
}

function spaceToml(routing: ValidatedCreateInput['routing']): string | null {
	switch (routing.kind) {
		case 'host':
			return `host = "${escapeTomlBasic(routing.host)}"\n`;
		case 'prefix':
			return `prefix = "${escapeTomlBasic(routing.prefix)}"\n`;
		case 'default':
			return `default = true\n`;
		case 'admin-only':
			return null;
	}
}

function indexMd(title: string): string {
	const t = escapeTomlBasic(title); // YAML basic-string compatible
	return `---\ntitle: "${t}"\n---\n\n# ${title}\n\nWelcome to ${title}. This is your homepage — open the editor to make it your own.\n`;
}

function classifyError(err: unknown): WriteErrorCode {
	const e = err as NodeJS.ErrnoException;
	if (e?.code === 'EEXIST') return 'dir_already_exists';
	if (e?.code === 'EACCES' || e?.code === 'EPERM') return 'permission_denied';
	return 'write_failed';
}

export async function createSpace(args: CreateSpaceArgs): Promise<CreateSpaceResult> {
	const { parentDir, input, __forceFailAfter } = args;
	const absPath = join(parentDir, input.slug);

	// Step 1: mkdir. Failure here doesn't need rollback — nothing was created.
	try {
		mkdirSync(absPath, { recursive: false });
	} catch (err) {
		return { kind: 'error', code: classifyError(err), detail: (err as Error)?.message };
	}
	if (__forceFailAfter === 'mkdir') {
		try { rmSync(absPath, { recursive: true, force: true }); } catch { /* best-effort */ }
		return { kind: 'error', code: 'write_failed', detail: 'forced fail after mkdir' };
	}

	try {
		writeFileSync(join(absPath, 'amber.toml'), amberToml(input.title));
		if (__forceFailAfter === 'amber') throw new Error('forced fail after amber');

		const st = spaceToml(input.routing);
		if (st !== null) writeFileSync(join(absPath, 'space.toml'), st);
		if (__forceFailAfter === 'space') throw new Error('forced fail after space');

		writeFileSync(join(absPath, 'index.md'), indexMd(input.title));
		if (__forceFailAfter === 'index') throw new Error('forced fail after index');
	} catch (err) {
		// Roll back — the dir didn't exist before us, so this is safe.
		try { rmSync(absPath, { recursive: true, force: true }); } catch { /* best-effort */ }
		return { kind: 'error', code: classifyError(err), detail: (err as Error)?.message };
	}

	return { kind: 'ok', absPath };
}
