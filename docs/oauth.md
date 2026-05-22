# Google OAuth setup

Amber's auth subsystem (v0.5 subsystem 2) supports two ways to sign in:
email + password (always on) and "Continue with Google" (optional). This
guide walks through enabling the Google provider end-to-end. It's aimed
at self-hosters who already have an Amber instance running behind a
public HTTPS URL.

If you only want email + password, you can skip this entirely — Google
sign-in is purely additive.

## What you'll get

- A "Continue with Google" button on `/admin/setup` (first-run admin
  claim) and `/admin/login`.
- A "Link Google" / "Unlink Google" control on `/admin/account` for an
  admin who claimed via password and wants to add Google later (or vice
  versa).
- Sign-ins land on `/admin` by default, or on the validated `?next=`
  destination if one was carried through the OAuth dance.

Account creation is gated by the same rules that apply to the password
path: the *first* Google sign-in claims the install-admin slot; every
subsequent sign-up requires a valid invite carried through the OAuth
dance (an HMAC-signed state token attached to the `callbackURL` — see
v0.5 subsystem 4). Strangers signing in with their own Google account
without a pending invite are rejected at the database hook.

Subsystem 4 also surfaces a "Continue with Google" button on the invite
redemption page at `/admin/invite/[token]` when Google is configured, so
an invitee can choose Google instead of setting an email + password.

## Prerequisites

Before you start:

- Amber is running and reachable at a stable public HTTPS URL (e.g.
  `https://amber.example.com`). Google rejects OAuth clients that point
  at `http://` for anything but `http://localhost`.
- `AMBER_PUBLIC_URL` is set in your `.env` next to the Compose files
  and matches that URL exactly (no trailing slash). Amber refuses to
  boot without it; see `docs/self-hosting.md`.
- `AMBER_AUTH_SECRET` is set to a long random string. Also a boot-time
  requirement, also documented in self-hosting.
- You have a Google account you're willing to use as the project owner
  for the OAuth credentials. (You don't have to use that same account to
  sign in to Amber later — it's just the account that owns the OAuth
  client in Google Cloud.)

## Step 1 — Open the Google Cloud Console

Go to <https://console.cloud.google.com/> and sign in with the Google
account you want to own the OAuth client.

If this is your first time using Google Cloud, you'll be asked to
accept the terms of service. You do **not** need to enable billing —
OAuth client creation is free.

## Step 2 — Create (or select) a project

In the project picker at the top of the console, either:

- **Pick an existing project** if you already use Google Cloud and want
  Amber's OAuth client to live alongside it, or
- **Create a new project** ("New Project", give it any name — e.g.
  `amber-personal-site`, no organisation required).

Wait for the project to finish creating, then make sure it's selected
in the project picker before moving on. Everything below assumes the
right project is selected.

## Step 3 — Configure the OAuth consent screen

Even for a single-user, personal Amber, Google requires a consent
screen before you can create a client ID.

Navigate to **APIs & Services → OAuth consent screen**.

1. **User Type**: pick **External**. (Internal is only available if
   you're in a Google Workspace organisation. External is correct for
   personal accounts.)
2. **App information**:
   - **App name**: anything you like — what users will see during
     sign-in (e.g. `Amber on amber.example.com`).
   - **User support email**: your email.
   - **App logo**: optional.
3. **App domain** (optional but recommended):
   - **Application home page**: your `AMBER_PUBLIC_URL`.
   - **Privacy policy** / **Terms of service**: optional for a personal
     site. Leave blank if you don't have them.
4. **Authorized domains**: add the bare domain of your
   `AMBER_PUBLIC_URL` (e.g. `example.com`, not the full URL). Google
   uses this to bound where redirects can land.
5. **Developer contact information**: your email again.
6. Click **Save and Continue**.
7. **Scopes**: don't add any. Amber only needs the default
   `openid email profile` scopes that better-auth requests on its own.
   Click **Save and Continue**.
8. **Test users**: add the Google account(s) you intend to sign in to
   Amber with. While the app is in "Testing" status, only listed test
   users can complete OAuth.
9. **Summary**: review and click **Back to Dashboard**.

You can leave the app in **Testing** mode forever for a personal Amber
— there's no reason to "Publish" unless you plan to let strangers sign
in (which the single-admin gate prevents anyway).

## Step 4 — Create the OAuth 2.0 Client ID

Navigate to **APIs & Services → Credentials**.

1. Click **Create Credentials → OAuth client ID**.
2. **Application type**: **Web application**.
3. **Name**: anything — e.g. `Amber web client`.
4. **Authorised JavaScript origins**: leave empty. Amber doesn't use
   the OAuth implicit flow.
5. **Authorised redirect URIs**: add **exactly one** URI:

   ```
   https://amber.example.com/api/auth/callback/google
   ```

   Substitute your real `AMBER_PUBLIC_URL` for `amber.example.com`. The
   path `/api/auth/callback/google` is fixed — that's where
   better-auth's handler lives. No trailing slash.

   This URI must match `AMBER_PUBLIC_URL` byte-for-byte. A trailing
   slash, a port mismatch, or `http://` vs `https://` will all cause
   Google to reject the callback with `redirect_uri_mismatch`.
6. Click **Create**.
7. A dialog shows your **Client ID** and **Client Secret**. Copy both
   to a secure place — the secret is only shown once. (You can rotate
   it later from the same screen if you lose it.)

## Step 5 — Wire the credentials into Amber

Add both values to the `.env` file next to your Compose files:

```env
AMBER_GOOGLE_CLIENT_ID=<the client id from step 4>
AMBER_GOOGLE_CLIENT_SECRET=<the client secret from step 4>
```

Two rules the auth subsystem enforces:

- **All or nothing.** Both vars must be set together. Half-configured
  OAuth is a fatal boot error (`Google OAuth is half-configured`),
  by design — silent half-configuration is a misconfiguration, not a
  feature.
- **No defaults.** Amber will not invent placeholder values; if the
  vars are absent, the Google button simply doesn't render and the
  email + password path is the only way in.

## Step 6 — Restart Amber

```sh
docker compose -f compose.prod.yaml up -d
```

(Or whatever your environment's restart command is — Amber is a single
process, so a normal restart picks up the new env.)

Watch the logs for a clean boot. A successful start prints the usual
`watcher started` / space init lines. If you see a fatal error
mentioning `Google OAuth is half-configured` or `AMBER_PUBLIC_URL`, fix
the named variable and restart.

## Verifying the integration

### First-time claim through Google

If your Amber has no admin yet:

1. Visit `https://amber.example.com/admin`. Amber redirects you to
   `/admin/setup`.
2. The setup page now shows **Continue with Google** below the form.
3. Click it. Google's consent screen appears; pick the account you
   added as a test user in Step 3.
4. After consent, Google redirects back to
   `/api/auth/callback/google?...` and better-auth completes the
   exchange.
5. You land on `/admin`, signed in. The page list renders.

If anything other than `/admin` is the landing page after success, the
fix from the v0.5 OAuth follow-up ticket may not be deployed —
re-deploy from `main`.

### Adding Google to an existing password-only admin

If you already claimed Amber with email + password and want to add
Google as a second sign-in option:

1. Sign in at `/admin/login` (password).
2. Visit `/admin/account`. The "Link Google" button appears.
3. Click it. You'll be sent through the Google consent screen and
   redirected back to `/admin/account` with Google linked.

### Removing Google later

From `/admin/account`, click **Unlink Google**. Amber requires you to
have a password set first — without one, unlinking would lock you out.
If you have no password yet, set one from the same page, then unlink.

### Resetting if you lock yourself out

If something goes wrong and you can't sign in at all (lost the OAuth
test user access, lost the password, deleted Google), the
offline-reset CLI is the escape hatch. From the host:

```sh
docker compose -f compose.prod.yaml exec amber \
  bun run --cwd apps/web reset-password
```

It takes an email + new password and writes directly to `auth.db`.
This is documented in the auth subsystem's spec under "Reset" and is
intentionally shell-only.

## Troubleshooting

**`redirect_uri_mismatch` from Google.**
The redirect URI on the OAuth client (Step 4) doesn't byte-match
`{AMBER_PUBLIC_URL}/api/auth/callback/google`. Common causes:

- `AMBER_PUBLIC_URL` has a trailing slash but the redirect URI
  doesn't, or vice versa. Pick a form and make both match.
- `AMBER_PUBLIC_URL` uses `http://` but Google's redirect URI is
  `https://`. (You can't register an `http://` non-localhost URI in
  Google Cloud — fix the public URL.)
- You typoed the domain in one place.

**Boot fails with `Google OAuth is half-configured`.**
You set one of `AMBER_GOOGLE_CLIENT_ID` / `AMBER_GOOGLE_CLIENT_SECRET`
but not the other. Set both, or unset both.

**"Continue with Google" button doesn't appear.**
Either the env vars aren't reaching the container (check
`docker compose config`) or you set them in `.env` but didn't restart
the container after editing.

**Google sign-in succeeds but Amber says "sign-up disabled" or
similar.**
An admin already exists, and the Google account you signed in with
isn't already linked to it. That's the single-admin gate doing its
job. Either sign in as the existing admin and link Google from
`/admin/account` (above), or use the reset-password CLI to take over.

**`/admin/login` Google button lands on `/` after sign-in.**
This was the v0.5 follow-up bug. The fix is in `main`; redeploy. The
e2e test `login page Google button carries callbackURL …` guards
against regressions.

**Test-mode 7-day token expiry.**
While the OAuth consent screen is in "Testing" status, Google refresh
tokens expire after 7 days. Since Amber doesn't use long-lived
Google refresh tokens (it relies on its own session cookie issued by
better-auth), this is rarely visible to the user — but if you ever
re-link an account after >7 days you'll just be prompted to consent
again. That's fine.

## What this doesn't cover

- **Other OAuth providers** (GitHub, Apple, etc.) — Amber's v0.5
  subsystem 2 ships with Google only; the seam is generic but no other
  provider is wired up.
- **Multi-user / invited authors** — subsystem 4 on the roadmap. Until
  then, Amber is single-admin no matter which sign-in method you use.
- **Custom OAuth consent screens / verification** — only relevant if
  you plan to take the app out of Testing mode, which a personal Amber
  has no reason to do.
