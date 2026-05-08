/**
 * Filesystem watcher for an Amber space. Normalizes raw chokidar events into
 * `FsEvent` values and feeds them into `Space.apply()`.
 *
 * The watcher is a thin event source — reconciliation logic lives in
 * `apply()`, not here. Per-path 50ms trailing-edge debounce collapses the
 * event storms editors produce on atomic-rename saves.
 *
 * Reserved names are excluded from the watch surface entirely (chokidar's
 * `ignored` option), so `.amber/cache.db` writes don't feed back into
 * `apply()` and trigger an infinite loop.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { relative, sep } from 'node:path';
import { logger } from '$lib/server/logger';
import { RESERVED_TOP_LEVEL } from '$lib/types/schema';
import type { FsEvent, Space } from './space.ts';

const log = logger.child({ subsystem: 'watcher' });

const DEBOUNCE_MS = 50;

type RawType = 'add' | 'change' | 'unlink';

interface Pending {
	timer: ReturnType<typeof setTimeout>;
	created: boolean; // any 'add' event seen during the window
	lastType: RawType;
}

export interface SpaceWatcherOptions {
	/** Override the trailing-edge debounce window (ms). Defaults to 50. */
	debounceMs?: number;
	/**
	 * Optional listener for events fed into `apply()`. Useful for tests; the
	 * production path doesn't need it because `apply()` mutates state in place.
	 */
	onEvent?: (event: FsEvent, delta: ReturnType<Space['apply']>) => void;
}

export class SpaceWatcher {
	private watcher: FSWatcher;
	private readonly space: Space;
	private readonly debounceMs: number;
	private readonly onEvent: SpaceWatcherOptions['onEvent'];
	private readonly pending = new Map<string, Pending>();
	private readyPromise: Promise<void>;

	constructor(space: Space, options: SpaceWatcherOptions = {}) {
		this.space = space;
		this.debounceMs = options.debounceMs ?? DEBOUNCE_MS;
		this.onEvent = options.onEvent;

		this.watcher = chokidar.watch(space.root, {
			ignoreInitial: true,
			// `awaitWriteFinish` would clash with our own debounce; we want to
			// observe every save event and collapse them ourselves.
			awaitWriteFinish: false,
			ignored: (absPath) => this.shouldIgnore(absPath)
		});

		this.watcher.on('add', (p) => this.queue('add', p));
		this.watcher.on('change', (p) => this.queue('change', p));
		this.watcher.on('unlink', (p) => this.queue('unlink', p));

		this.readyPromise = new Promise((resolve) => {
			this.watcher.once('ready', () => resolve());
		});
	}

	/** Resolves once the initial scan completes and the watcher is live. */
	ready(): Promise<void> {
		return this.readyPromise;
	}

	async close(): Promise<void> {
		// Flush any pending debounced events synchronously so close() is a
		// quiescent point — useful in tests.
		for (const [rel, pending] of this.pending) {
			clearTimeout(pending.timer);
			this.flush(rel, pending);
		}
		this.pending.clear();
		await this.watcher.close();
	}

	// ─── internals ────────────────────────────────────────────────────────

	private shouldIgnore(absPath: string): boolean {
		const rel = relative(this.space.root, absPath);
		if (rel === '' || rel === '.') return false;
		const segs = rel.split(sep);
		// `amber.toml` lives in RESERVED_TOP_LEVEL but we *do* watch it.
		if (segs.length === 1 && segs[0] === 'amber.toml') return false;
		if (RESERVED_TOP_LEVEL.has(segs[0])) return true;
		if (segs.some((s) => s.startsWith('_') || s.startsWith('.'))) return true;
		return false;
	}

	private queue(rawType: RawType, absPath: string): void {
		const rel = relative(this.space.root, absPath).split(sep).join('/');
		const existing = this.pending.get(rel);
		const created = (existing?.created ?? false) || rawType === 'add';
		if (existing) clearTimeout(existing.timer);
		const timer = setTimeout(() => {
			const p = this.pending.get(rel);
			if (!p) return;
			this.pending.delete(rel);
			this.flush(rel, p);
		}, this.debounceMs);
		this.pending.set(rel, { timer, created, lastType: rawType });
	}

	private flush(rel: string, p: Pending): void {
		// add+unlink within one debounce window cancels itself out.
		if (p.lastType === 'unlink' && p.created) return;

		// `amber.toml` is a single special case.
		if (rel === 'amber.toml') {
			// `unlink` of the manifest is unrecoverable territory; we still
			// fire `manifest_change` so apply() surfaces a typed error to
			// callers that wired up an error boundary.
			const event: FsEvent = { type: 'manifest_change' };
			this.dispatch(event);
			return;
		}

		// Only markdown files contribute to the page index.
		if (!rel.toLowerCase().endsWith('.md')) return;

		let type: 'add' | 'change' | 'unlink';
		if (p.lastType === 'unlink') type = 'unlink';
		else if (p.created) type = 'add';
		else type = 'change';

		this.dispatch({ type, path: rel });
	}

	private dispatch(event: FsEvent): void {
		try {
			const delta = this.space.apply(event);
			this.onEvent?.(event, delta);
		} catch (err) {
			// Surface as a structured warning; the in-memory index has not
			// been corrupted because apply() mutations are local to the
			// affected slice.
			log.warn({ err, event }, 'apply() threw');
		}
	}
}
