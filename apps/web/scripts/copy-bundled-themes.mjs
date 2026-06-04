/**
 * Postbuild: copy the app-bundled themes into the adapter-node build output so
 * they ship in the Docker image. `build/themes/` is server-only (not under
 * `build/client/`), so theme HTML templates are never publicly served; the
 * asset route serves css/fonts from it deliberately. The runtime addresses this
 * dir via AMBER_BUNDLED_THEMES_DIR=/app/build/themes (see Dockerfile).
 */
import { cpSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../themes/', import.meta.url));
const dest = fileURLToPath(new URL('../build/themes/', import.meta.url));

if (!existsSync(src)) {
	console.error(`copy-bundled-themes: source themes dir not found: ${src}`);
	process.exit(1);
}
cpSync(src, dest, { recursive: true });
console.log(`copy-bundled-themes: copied ${src} -> ${dest}`);
