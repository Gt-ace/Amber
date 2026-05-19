/**
 * Guards the whole /admin authoring surface (spec §8). Every admin PAGE route
 * runs this layout load. The PUT save endpoint is a +server.ts module — those
 * are NOT covered by layout loads, so it calls requireAuthor() itself.
 */

import { requireAuthor } from '$lib/server/auth';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = (event) => {
	requireAuthor(event);
	return {};
};
