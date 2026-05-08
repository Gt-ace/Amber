/**
 * Initialize the Space singleton at startup so a misconfigured
 * AMBER_SPACE_PATH (or an unreadable space) fails the boot, not the first
 * request.
 *
 * Each request also gets a short request_id and a child logger on
 * `event.locals.log`. Start/end of every request is logged at info level
 * with method, path, status, and duration_ms.
 */

import type { Handle } from '@sveltejs/kit';
import { logger } from '$lib/server/logger';
import { getSpace } from '$lib/server/space';

getSpace();

function newRequestId(): string {
	return crypto.randomUUID().replace(/-/g, '').slice(0, 8);
}

export const handle: Handle = async ({ event, resolve }) => {
	const request_id = newRequestId();
	const log = logger.child({ request_id });
	event.locals.log = log;

	const method = event.request.method;
	const path = event.url.pathname;
	const start = performance.now();

	log.info({ method, path }, 'request start');

	let status = 500;
	try {
		const response = await resolve(event);
		status = response.status;
		return response;
	} finally {
		const duration_ms = Math.round(performance.now() - start);
		log.info({ method, path, status, duration_ms }, 'request end');
	}
};
