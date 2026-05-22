/**
 * Constructs the `betterAuth(...)` instance used by every server-side caller
 * — `hooks.server.ts`, the setup/login/account routes, and the reset-password
 * CLI (spec §6, §8, §10).
 *
 * Three env vars shape the config:
 *
 *   - AMBER_AUTH_SECRET (required) — signs session cookies. Boot fails if
 *     unset; we never fall back to a default.
 *   - AMBER_GOOGLE_CLIENT_ID / AMBER_GOOGLE_CLIENT_SECRET (optional, but
 *     all-or-nothing). Both set → the Google provider is registered. Half
 *     configured → fatal boot error.
 *   - AMBER_PUBLIC_URL (already in use for the sitemap) — reused as the OAuth
 *     callback base.
 *
 * Sign-up is gated by a `databaseHooks.user.create.before` guard: only the
 * first admin (zero existing users) gets through. Once one user exists, the
 * hook rejects every subsequent creation — covers both the public sign-up
 * endpoint and the social-callback create path with one rule (spec §3, §5).
 * Email-password sign-up stays *enabled* on better-auth's side so the setup
 * action can call `auth.api.signUpEmail()` for the first claim; after that,
 * the hook is the single source of truth.
 *
 * Module-import is side-effect free. `getAuth()` builds the instance lazily
 * and runs better-auth's Kysely migrations once on the first call. Tests use
 * `buildAuth({ dbPath })` for throwaway instances.
 */

import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { APIError } from 'better-auth/api';
import { getMigrations } from 'better-auth/db/migration';
import { sveltekitCookies } from 'better-auth/svelte-kit';
import { getRequestEvent } from '$app/server';
import type { Database } from 'bun:sqlite';
import { authDbPath, openAuthDb } from '$lib/server/auth-db';
import { applyAmberAuthMigrations } from '$lib/server/auth-migrations';

export interface BuildAuthOptions {
	dbPath?: string;
	db?: Database;
	secret?: string;
	publicUrl?: string;
	google?: { clientId: string; clientSecret: string } | null;
}

export type Auth = ReturnType<typeof betterAuth>;

/**
 * `getRequestEvent` only resolves inside SvelteKit's `handle`. The
 * `sveltekitCookies` plugin calls it from an after-hook to mirror cookies;
 * in production it always succeeds. The catch is for tests that invoke
 * `auth.api.*` directly (outside any request lifecycle) — there's no event
 * to mirror cookies to, so a no-op is correct.
 */
function safeGetRequestEvent() {
	try {
		return getRequestEvent();
	} catch {
		return undefined;
	}
}

function requireSecret(supplied?: string): string {
	const s = supplied ?? process.env.AMBER_AUTH_SECRET;
	if (!s || s.length === 0) {
		throw new Error(
			'AMBER_AUTH_SECRET is required. Set a random secret in the environment ' +
				'(see compose.yaml / docs/self-hosting.md). The auth subsystem refuses ' +
				'to boot without it.'
		);
	}
	return s;
}

function requirePublicUrl(supplied?: string): string {
	const u = supplied ?? process.env.AMBER_PUBLIC_URL;
	if (!u || u.length === 0) {
		throw new Error(
			'AMBER_PUBLIC_URL is required. Set it in the .env file next to your ' +
				'compose files (e.g. https://your-domain.example). It is used as the ' +
				'OAuth callback base, the origin-trust value, and the sitemap base. ' +
				'The auth subsystem refuses to boot without it.'
		);
	}
	return u;
}

/** Resolve the Google OAuth env pair, enforcing the all-or-nothing rule. */
export function resolveGoogleEnv(env: NodeJS.ProcessEnv = process.env): {
	clientId: string;
	clientSecret: string;
} | null {
	const id = env.AMBER_GOOGLE_CLIENT_ID;
	const secret = env.AMBER_GOOGLE_CLIENT_SECRET;
	if (id && secret) return { clientId: id, clientSecret: secret };
	if (!id && !secret) return null;
	throw new Error(
		'Google OAuth is half-configured: set BOTH AMBER_GOOGLE_CLIENT_ID and ' +
			'AMBER_GOOGLE_CLIENT_SECRET, or neither. Half-configured OAuth is a ' +
			'misconfiguration, not a feature.'
	);
}

export function buildAuth(opts: BuildAuthOptions = {}): { auth: Auth; db: Database } {
	const db = opts.db ?? openAuthDb(opts.dbPath ?? authDbPath());
	const secret = requireSecret(opts.secret);
	const google = opts.google !== undefined ? opts.google : resolveGoogleEnv();
	const baseURL = requirePublicUrl(opts.publicUrl);

	const config: BetterAuthOptions = {
		appName: 'Amber',
		secret,
		baseURL,
		database: db,
		// Trust the public URL as the only allowed origin; SvelteKit's own
		// CSRF/SameSite cookie defaults cover the rest.
		trustedOrigins: [baseURL],
		emailAndPassword: {
			enabled: true
			// disableSignUp stays false: the setup action calls signUpEmail() for
			// the first admin. The user-create hook gates every subsequent attempt.
		},
		socialProviders: google
			? {
					google: {
						clientId: google.clientId,
						clientSecret: google.clientSecret
					}
				}
			: undefined,
		plugins: [
			// Forwards better-auth's Set-Cookie headers to the SvelteKit response
			// when auth.api.* is called inside a form action or load. The wrapper
			// makes the plugin a no-op when there is no live request event (i.e.
			// in tests that call actions directly, outside SvelteKit's `handle`).
			sveltekitCookies(safeGetRequestEvent as typeof getRequestEvent)
		],
		databaseHooks: {
			user: {
				create: {
					before: async () => {
						// Single-admin subsystem (spec §1, §5). The first creation is
						// allowed; everything after is rejected. SQLite is single-writer
						// under WAL, so by the time the second hook fires the first row
						// is committed and the count returns ≥ 1.
						const row = db.query('SELECT COUNT(*) AS n FROM user').get() as
							| { n: number }
							| undefined;
						const n = row?.n ?? 0;
						if (n >= 1) {
							throw new APIError('FORBIDDEN', {
								message:
									'Sign-up is disabled. Amber is single-admin in this version; ' +
									'the admin account has already been claimed.'
							});
						}
					}
				}
			}
		}
	};

	const auth = betterAuth(config);
	return { auth, db };
}

let _singleton: { auth: Auth; db: Database } | null = null;
let _migrated = false;

export async function getAuth(): Promise<Auth> {
	if (!_singleton) _singleton = buildAuth();
	if (!_migrated) {
		const { runMigrations } = await getMigrations(_singleton.auth.options);
		await runMigrations();
		// Amber-side schema (isInstallAdmin column, member, invite). Must run
		// AFTER better-auth's migrations because migration 0001 ALTERs better-
		// auth's `user` table.
		applyAmberAuthMigrations(_singleton.db);
		_migrated = true;
	}
	return _singleton.auth;
}

export function getAuthSync(): Auth {
	if (!_singleton) _singleton = buildAuth();
	return _singleton.auth;
}

/**
 * Direct access to the singleton's bun:sqlite handle. For the small handful
 * of places we need to count admins or read an account row outside the
 * better-auth API (login load's "0 admins? redirect to setup"; setup
 * action's race re-check; reset-password CLI).
 */
export function getAuthDb(): Database {
	if (!_singleton) _singleton = buildAuth();
	return _singleton.db;
}

/** Test-only: reset the singleton so the next getAuth() rebuilds. */
export function _resetAuthSingleton(): void {
	if (_singleton) {
		try {
			_singleton.db.close();
		} catch {
			// already closed; nothing to do
		}
	}
	_singleton = null;
	_migrated = false;
}
