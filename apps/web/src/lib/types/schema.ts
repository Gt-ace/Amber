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
     * Ordered nav. Entries pointing at missing files are dropped with a warning
     * at load time; the manifest on disk is never silently rewritten.
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
 * A nav entry is either a leaf (points at a page) or a group (has children).
 * We use a discriminated union rather than optional fields so the loader
 * can't accidentally treat a malformed entry as both.
 */
export type NavEntry = NavLeaf | NavGroup | NavExternal;

export interface NavLeaf {
    kind: "page";
    /** Space-relative path to the markdown file, e.g. "about.md" or "posts/hello/index.md". */
    path: string;
    /** Display label. If absent, falls back to the page's frontmatter `title`. */
    label?: string;
}

export interface NavGroup {
    kind: "group";
    label: string;
    children: NavEntry[];
}

export interface NavExternal {
    kind: "external";
    label: string;
    url: string;
}

export interface ThemeConfig {
    name: string;
    options?: Record<string, unknown>;
}

export interface PluginConfig {
    enabled?: boolean;
    options?: Record<string, unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Frontmatter (per-page YAML)
// ─────────────────────────────────────────────────────────────────────────────

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

    /** All non-draft pages, keyed by URL path (leading slash, no trailing slash, "/" for root). */
    pages: Map<string, Page>;

    /**
     * Reconciled nav. Same shape as manifest.nav but with missing entries
     * dropped and unlisted files appended (or hidden — see loader policy).
     * Leaves carry a resolved URL so themes don't re-derive it.
     */
    nav: ResolvedNavEntry[];

    /** Compiled redirects map. Keys and values normalized (leading slash, no trailing). */
    redirects: Map<string, string>;

    /** Warnings surfaced during load — missing nav targets, malformed frontmatter, etc. */
    warnings: LoadWarning[];
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

export type ResolvedNavEntry =
    | { kind: "page"; label: string; url: string; page: Page }
    | { kind: "group"; label: string; children: ResolvedNavEntry[] }
    | { kind: "external"; label: string; url: string };

export interface LoadWarning {
    /** Machine-readable code so we can suppress specific classes in tests. */
    code:
    | "manifest_nav_missing_target"
    | "frontmatter_parse_error"
    | "duplicate_url"
    | "reserved_name_in_content"
    | "redirect_loop";
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
