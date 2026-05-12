/**
 * Amber on-disk schema — TypeScript types
 *
 * This file is the contract between the filesystem and everything else.
 * Loader, watcher, routes, and (eventually) plugins all speak these types.
 *
 * Principle: filesystem is truth, manifest is authoritative for nav order,
 * SQLite is a regenerable cache. These types describe the truth, not the cache.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Manifest (amber.toml)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The full parsed amber.toml. Every field except `amber_version` is optional
 * because a fresh space should be valid with just `amber_version = "0.1"`.
 */
export interface AmberManifest {
    /**
     * Schema version. Used for migrations. A loader refusing to load a newer
     * version is the right behavior; silently upgrading on disk is not.
     */
    amber_version: string;

    /** Site-wide metadata. */
    site?: SiteConfig;

    /**
     * Ordered nav. A flat list of `{ label, href }` links. `href` is whatever
     * the author wrote — internal path or external URL — the loader does not
     * resolve it against the page index. Malformed entries (missing required
     * fields, wrong types) are skipped at load time with a structured log;
     * the manifest on disk is never rewritten.
     */
    nav?: NavEntry[];

    /**
     * URL redirects. Reserved from day one even if unused — having the table
     * present means moving a page later doesn't require a schema bump.
     * Key is the old path, value is the new path. Both are space-relative,
     * leading slash optional, no trailing slash.
     */
    redirects?: Record<string, string>;

    /**
     * Theme selection. A bare string names a built-in or installed theme;
     * the object form allows passing theme-specific config. Themes live in
     * `themes/` at the space root (reserved name).
     */
    theme?: string | ThemeConfig;

    /**
     * Plugin config. Same shape as themes — bare string for "enabled, defaults"
     * or object for "enabled with these settings". Plugin state lives in
     * `.amber/plugins/<name>/`, never in the manifest.
     */
    plugins?: Record<string, true | PluginConfig>;
}

export interface SiteConfig {
    title?: string;
    description?: string;
    /** Canonical base URL, no trailing slash. Used for absolute links, OG tags, RSS. */
    url?: string;
    /** Default author; pages can override via frontmatter. */
    author?: string;
    /** ISO 639-1 (e.g. "en", "de"). Defaults to "en" if absent. */
    language?: string;
}

/**
 * A nav entry is a `{ label, href }` link. Both fields are required strings.
 * `href` is opaque to the loader: an internal path like `/about` or an
 * external URL like `https://example.com` are equally valid — themes render
 * the link verbatim. Extra keys on a `[[nav]]` entry are ignored, leaving
 * room for forward-compatible additions without a schema bump.
 */
export interface NavEntry {
    label: string;
    href: string;
}

export interface ThemeConfig {
    name: string;
    options?: Record<string, unknown>;
}

/**
 * Parsed `theme.toml`. Every field optional — a theme directory with just an
 * empty `theme.toml` is valid metadata-wise. (Template defaults are *not* a
 * thing in v0.2: a theme missing any of the three template files is skipped at
 * discovery — see `discoverThemes`.) Keys are TOML-native snake_case, matching
 * the rest of the manifest surface (`amber_version`, `redirect_from`).
 */
export interface ThemeManifest {
    /** Display name. Defaults to the directory name. */
    name?: string;
    version?: string;
    author?: string;
    /**
     * `theme-color` meta values. The theme declares them here instead of route
     * code duplicating `--amber-bg` light/dark (SPIKE_NOTES). Rendered into
     * `<meta name="theme-color">` by the layout.
     */
    theme_color?: { light?: string; dark?: string };
    /**
     * Footer slot. The chrome template renders `{{footer_label}}` linking to
     * `{{footer_href}}`. The spike hardcoded "Source → GitHub" here; this is
     * the configurable slot SPIKE_NOTES called for.
     */
    footer?: { label?: string; href?: string };
}

/**
 * A discovered, usable theme. "Usable" means `theme.toml` parsed and all three
 * template files (`chrome.html`, `page.html`, `error.html`) exist on disk;
 * incomplete theme directories are skipped at discovery with a structured log.
 *
 * Template *contents* are not held here — they're read from disk at request
 * time via `readTemplate(theme, kind)` (which special-cases the built-in
 * theme, whose `path` is `''` and whose templates are in-app constants).
 */
export interface Theme {
    /** Directory name under `<space>/themes/`. The identity `amber.toml`'s `theme = "..."` matches against. */
    name: string;
    /** Absolute path to the theme directory. `''` for the in-app `BUILTIN_THEME` (no disk dir). */
    path: string;
    /** URL prefix for this theme's static assets, e.g. `/themes/amber-default`. `''` for the built-in theme (its templates emit no stylesheet `<link>`). */
    assetBase: string;
    manifest: ThemeManifest;
}

export interface PluginConfig {
    enabled?: boolean;
    options?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter (per-page YAML)
// ─────────────────────────────────────────────────────────────────────────────

/** Sort order for an `auto_index` listing. */
export type AutoIndexSort = "date desc" | "date asc" | "title asc";

/**
 * A validated, normalized `auto_index` directive as it lives on an in-memory
 * `Page`. `path` is content-root-relative, posix-separated, no leading or
 * trailing slash. `sort` is always present (defaults to `"date desc"`).
 * `limit`, when present, is a positive integer; absent means no limit.
 */
export interface AutoIndexDirective {
    path: string;
    sort: AutoIndexSort;
    limit?: number;
}

/**
 * Frontmatter is parsed from the YAML block at the top of each markdown file.
 * All fields are optional — a file with no frontmatter is valid content.
 *
 * Unknown keys are preserved on the Page object (see `extra`) so plugins and
 * themes can read custom fields without us needing to know about them.
 */
export interface PageFrontmatter {
    title?: string;
    description?: string;

    /**
     * URL slug override. Without this, the URL derives from the filesystem path.
     * With it, this segment replaces the filename (but not parent directories).
     * E.g. `posts/2024-01-thing.md` with `slug: thing` → `/posts/thing`.
     */
    slug?: string;

    /**
     * Drafts are excluded from the rendered site by default. Dev mode can opt in
     * via env var. This is a frontmatter flag, never a directory convention —
     * keeps the URL stable when a post moves from draft to published.
     */
    draft?: boolean;

    /**
     * Authoring date. ISO 8601 string both on disk and in memory.
     * YAML-native date values (e.g. `date: 2025-03-14`) are coerced to ISO
     * strings during loading; invalid values are dropped with a
     * `frontmatter_parse_error` warning. Used for sorting, RSS, displayed
     * metadata.
     */
    date?: string;
    /** Last-updated date. Same convention as `date`. */
    updated?: string;

    /**
     * Auto-index directive (Wave 3 P1). When present, the page renders the
     * theme's `partials/index.html` listing the markdown pages under `path`
     * (relative to the content root), below the page's own rendered body.
     * The loader validates and normalizes this on read — an in-memory `Page`
     * either carries a fully-normalized `AutoIndexDirective` (with `sort`
     * defaulted) or no `auto_index` at all (an invalid directive is dropped
     * with an `auto_index_*` LoadWarning; the page still renders).
     */
    auto_index?: AutoIndexDirective;

    author?: string;
    tags?: string[];

    /**
     * Layout hint for themes. Themes are free to ignore it or define their own
     * vocabulary; "page" and "post" are the only conventional values.
     */
    layout?: string;

    /**
     * Old URLs that should redirect to this page. Each entry is a space-relative
     * URL; the loader merges these into `Space.redirects` so route handlers can
     * issue 308s. Authors who move a page list its previous URL here; the entry
     * is also created automatically when the loader detects a body-hash-stable
     * rename (see auto-rename detection in the cache layer).
     */
    redirect_from?: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// In-memory representation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A loaded space. This is what `Space.load()` returns and what routes consume.
 * Everything is already resolved: URLs computed, frontmatter parsed, nav
 * reconciled against the filesystem.
 *
 * Rendered HTML lives on Page, not here, and is computed lazily — the loader
 * gives you the parsed AST or raw markdown; rendering happens at request time
 * (cached by content hash) so theme changes don't require a reload.
 */
export interface Space {
    root: string; // absolute path on disk
    manifest: AmberManifest;

    /** All pages (drafts included — consumers filter), keyed by URL path (leading slash, no trailing slash, "/" for root). */
    pages: Map<string, Page>;

    /**
     * Validated nav. Same shape as `manifest.nav`: malformed entries are
     * dropped at load time (with a structured log), valid entries pass
     * through unchanged. No resolution happens — `href` is whatever the
     * author wrote.
     */
    nav: NavEntry[];

    /** Compiled redirects map. Keys and values normalized (leading slash, no trailing). */
    redirects: Map<string, string>;

    /** Warnings surfaced during load — missing nav targets, malformed frontmatter, etc. */
    warnings: LoadWarning[];

    /**
     * All usable themes discovered under `<root>/themes/`, keyed by directory
     * name. Empty if the space has no `themes/` directory. Fixed at load —
     * `themes/` is a reserved name and isn't watched; restart to pick up theme
     * changes.
     */
    themes: Map<string, Theme>;

    /**
     * The active theme: `amber.toml`'s `theme` (string or `{ name }`), defaulted
     * to `"amber-default"`, resolved against `themes`. Falls back to the in-app
     * `BUILTIN_THEME` when neither the configured name nor `amber-default` is a
     * usable discovered theme (logged). Never null — consumers always have a
     * theme to render with.
     */
    theme: Theme;
}

export interface Page {
    /** Absolute path on disk. Source of truth for change detection. */
    filePath: string;

    /** Space-relative path, e.g. "posts/hello/index.md". Stable identifier. */
    relativePath: string;

    /** Resolved URL: leading slash, no trailing, "/" for the root index. */
    url: string;

    frontmatter: PageFrontmatter;

    /**
     * Frontmatter keys not in PageFrontmatter, preserved verbatim for plugins/themes.
     * Don't put schema-defined fields here — they live on `frontmatter`.
     */
    extra: Record<string, unknown>;

    /**
     * Raw markdown body (frontmatter stripped). Rendering to HTML is the
     * responsibility of the render layer, not the loader.
     */
    body: string;

    /** mtime + content hash. Either is enough for cache invalidation; we keep both. */
    mtime: number;
    contentHash: string;
}

export interface LoadWarning {
    /**
     * Machine-readable code so we can suppress specific classes in tests.
     *
     * Reserved-but-unfired in v0.2 (declared so that landing the relevant
     * feature later doesn't require a schema bump, mirroring `redirect_loop`):
     *   - `manifest_nav_missing_target`: the v0.1 nav schema validated nav
     *     entries against the page index. The v0.2 schema is `{ label, href }`
     *     — `href` is opaque, so this code has no trigger today.
     *   - `reserved_name_in_content`: same story; v0.1 manifests could
     *     reference into reserved space via `path = "_drafts/..."`. The v0.2
     *     `href` field carries no path semantics for the loader.
     *   - `redirect_loop`: redirects aren't resolved yet (see CLAUDE.md →
     *     "LoadWarning codes").
     *
     * `auto_index_*` (Wave 3 P1): a page's `auto_index` frontmatter is
     * malformed — `path` missing / not a string / not a directory under the
     * content root (`auto_index_path_missing`); `sort` not one of the allowed
     * values (`auto_index_invalid_sort`); `limit` not a positive integer
     * (`auto_index_invalid_limit`). Each warning drops the directive; the page
     * still renders, just without the index.
     */
    code:
    | "manifest_nav_missing_target"
    | "frontmatter_parse_error"
    | "duplicate_url"
    | "reserved_name_in_content"
    | "redirect_loop"
    | "auto_index_path_missing"
    | "auto_index_invalid_sort"
    | "auto_index_invalid_limit";
    message: string;
    /** Space-relative path or manifest pointer, where applicable. */
    source?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reserved names
// ─────────────────────────────────────────────────────────────────────────────

/** Top-level names the loader skips when discovering content. */
export const RESERVED_TOP_LEVEL = new Set([
    "amber.toml",
    ".amber",
    "themes",
]);

/** Prefixes that mark a path as non-content at any depth. */
export const RESERVED_PREFIXES = ["_", "."] as const;

export function isReservedPath(segment: string): boolean {
    if (RESERVED_TOP_LEVEL.has(segment)) return true;
    return RESERVED_PREFIXES.some((p) => segment.startsWith(p));
}
