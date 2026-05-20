/**
 * Guards every authenticated admin page route (spec §2, §6).
 *
 * `requireAuthor()` throws 401 when there's no session — for page routes we
 * want a redirect to `/admin/login?next=<original-url>`, not a JSON 401.
 * This layout translates the throw into that redirect. The PUT save endpoint
 * keeps the 401 it returns today; it never runs a layout load.
 */

import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	if (event.locals.user == null) {
		const next = event.url.pathname + event.url.search;
		redirect(302, `/admin/login?next=${encodeURIComponent(next)}`);
	}
	return { user: event.locals.user };
};
