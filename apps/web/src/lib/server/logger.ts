/**
 * Structured logging via pino.
 *
 * One process-wide logger. Subsystems (`space`, `watcher`, `cache`, `render`,
 * `server`) use child loggers tagged with `subsystem`. Per-request child
 * loggers are attached in `hooks.server.ts` to `event.locals.log` so handlers
 * can log with a request-scoped `request_id`.
 *
 * No transports are configured: logs go to stdout as plain JSON. If a
 * developer wants pretty output they pipe through `pino-pretty` themselves.
 *
 * This module is server-only by location (`lib/server/`); never import it
 * from anywhere that ships to the client.
 */

import pino from 'pino';

function resolveLevel(): pino.LevelWithSilent {
	const isDev =
		// `import.meta.env.DEV` is the Vite-side signal; fall back to NODE_ENV
		// for non-Vite contexts (tests, the production node entrypoint).
		(typeof import.meta !== 'undefined' && (import.meta as { env?: { DEV?: boolean } }).env?.DEV) ||
		process.env.NODE_ENV !== 'production';
	return isDev ? 'debug' : 'info';
}

export const logger = pino({
	level: resolveLevel(),
	base: undefined
});

export type Logger = pino.Logger;
