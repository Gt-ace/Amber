/**
 * Initialize the Space singleton at startup so a misconfigured
 * AMBER_SPACE_PATH (or an unreadable space) fails the boot, not the first
 * request.
 */

import { getSpace } from '$lib/server/space';

getSpace();
