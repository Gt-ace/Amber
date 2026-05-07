// Minimal type declarations for `bun:sqlite`.
//
// We don't pull in `bun-types` to avoid expanding the dev dependency
// surface for what amounts to one module. The shapes here cover only
// what `cache.ts` uses; round them out as the cache grows.

declare module 'bun:sqlite' {
	export interface Statement {
		run(...args: unknown[]): { changes: number; lastInsertRowid: number };
		get(...args: unknown[]): unknown;
		all(...args: unknown[]): unknown[];
		values(...args: unknown[]): unknown[][];
	}

	export class Database {
		constructor(
			filename?: string,
			options?: { readonly?: boolean; create?: boolean; readwrite?: boolean }
		);
		exec(sql: string): void;
		prepare(sql: string): Statement;
		transaction<T extends (...args: unknown[]) => unknown>(fn: T): T;
		close(): void;
	}
}
