# Self-hosting Amber

This document walks through deploying Amber to a Linux server you control. It
assumes you have a domain name, a VPS with a public IPv4 address, and SSH
access.

## Prerequisites

- Linux server (any modern distro; instructions assume Ubuntu/Debian),
  1 vCPU, 2 GB RAM, public IPv4.
- Docker Engine and Compose v2 installed.
- `git` installed (it's preinstalled on most distros).
- A domain name with DNS you can edit.
- SSH access as a user with sudo.

Reference point: `amber.avp.software` runs on a Hetzner CX23 in Nuremberg.
That's the floor; anything comparable works.

## Step 1 — Point DNS at the server

Create an A record for your domain (or subdomain) pointing at the server's
public IPv4. Propagation usually takes a few minutes; verify with
`dig +short your-domain.example`.

## Step 2 — Get the code onto the server

SSH in as the user that will run Amber, then:

```
git clone https://github.com/Gt-ace/Amber.git /home/$USER/amber
cd /home/$USER/amber
```

Any path the deploying user can write works; `/home/$USER/amber` is the
example the rest of this doc references. Your content lives under
`spaces/` inside the clone — editing files there changes the served site.

## Step 3 — Create your space

The repo ships two spaces: `spaces/example/` (used by the desktop
quick-start) and `spaces/avp-software/` (the operator's own site). Pick one
to copy as a starting point:

```
cp -r spaces/example spaces/your-site
```

Edit `spaces/your-site/amber.toml` to set `[site].title` and the nav
entries you want. The space directory you create here is what production
will serve.

## Step 4 — Configure the production compose

The repo ships `compose.prod.yaml` configured for `amber.avp.software`. Two
substitutions and one secret are needed.

**Space mount.** In `compose.prod.yaml`, this line:

```
      - ./spaces/avp-software:/space
```

Change `avp-software` to your space directory name (e.g.
`./spaces/your-site:/space`).

**Caddy site address.** In `Caddyfile`, this block:

```
amber.avp.software {
	reverse_proxy web:3000
}
```

Replace `amber.avp.software` with your domain. The repo's `Caddyfile` also
contains a `jellyfin.avp.software { … }` block — that's specific to the
operator's server and unrelated to Amber. Delete it.

Caddy issues a Let's Encrypt certificate automatically the first time the
site is reached over HTTPS, using the domain you just set. No further TLS
configuration is needed.

**Auth secret.** Amber refuses to boot without `AMBER_AUTH_SECRET` — it
signs the admin session cookie, and a missing or guessable secret means
forgeable sessions. Create a `.env` file next to the compose files with at
least:

```
AMBER_AUTH_SECRET=<a fresh `openssl rand -hex 32`>
AMBER_PUBLIC_URL=https://your-domain.example
```

Compose reads `.env` automatically. Treat the secret like an SSH key: don't
commit it, don't reuse it across deployments.

**Optional: Google sign-in.** If you'd like a backup sign-in method, also
set:

```
AMBER_GOOGLE_CLIENT_ID=<from Google Cloud Console>
AMBER_GOOGLE_CLIENT_SECRET=<from Google Cloud Console>
```

Register `https://your-domain.example/api/auth/callback/google` as an
authorized redirect URI in the Google Cloud Console OAuth credentials.
Both vars must be set together — half-configured OAuth is a boot error,
not a partial feature.

## Step 5 — Start the stack

From the repo root, on the server:

```
docker compose -f compose.prod.yaml up -d --build
```

`-f compose.prod.yaml` is required because the repo root also ships
`compose.yaml` (the desktop-developer install) and Compose's default lookup
would otherwise pick that file. `--build` is required on first start and
whenever app code changes; without it Compose keeps the old image and only
content changes (the bind-mounted space) would be picked up.

The stack is two services: `web` (the Amber app, exposed only inside the
Compose network) and `caddy` (reverse proxy on host ports 80 and 443).

## Step 6 — Verify and claim the admin

```
curl -I https://your-domain.example
```

Should return `HTTP/2 200`. Once it does, open
`https://your-domain.example/admin` in a browser. The first visit
redirects to `/admin/setup` because no admin exists yet. Fill in your
email, a strong password, and submit. The page disappears once you've
claimed it: there is no way to claim the admin twice.

If you lose access to the admin account later, see "Recovery" below.

If the initial `curl` returns `HTTP/2 503` or hangs, Caddy hasn't completed
Let's Encrypt's HTTP-01 challenge yet — wait up to a minute and retry. If
it still fails, check `docker compose -f compose.prod.yaml logs caddy` for
the actual error (usually a DNS mismatch or port 80 blocked at the
firewall).

## Step 7 — Persistence across reboots

The repo includes `amber.service`, a systemd unit that brings the Compose
stack up on boot and down on shutdown. It runs `docker compose -f
compose.prod.yaml up -d` against whatever image already exists; it does
**not** rebuild or pull. Rebuilds are a separate operation (see Updating
below).

Before installing the unit, edit three fields in `amber.service` to match
your setup:

```
WorkingDirectory=/home/amber/Amber
User=amber
Group=amber
```

`WorkingDirectory` must be the absolute path of your clone (case-exact —
`amber` and `Amber` are different paths). `User` and `Group` must be the
account that owns the clone and can talk to the Docker daemon.

Then install:

```
sudo cp amber.service /etc/systemd/system/amber.service
sudo systemctl daemon-reload
sudo systemctl enable --now amber.service
```

Verify with `systemctl status amber.service` — it should report
`active (exited)` (the unit is `Type=oneshot` with `RemainAfterExit=yes`,
which is normal for a unit whose job is to invoke `docker compose up -d`).

## Updating

On the server:

```
cd /home/$USER/amber
git pull
docker compose -f compose.prod.yaml up -d --build
```

That's it. Content changes inside your space directory don't need this —
the watcher hot-reloads on `git pull` (or on direct file edits) without a
restart. The `--build` matters when app code or `Dockerfile` changed.

The repo also ships `bin/deploy`, which performs the same three steps
remotely over SSH from a workstation (it reads `AMBER_DEPLOY_HOST` and
`AMBER_DEPLOY_PATH` env vars). If you maintain a local checkout and want a
one-command deploy from your laptop, use it; if you're administering the
server directly, the commands above are equivalent.

## Recovery

If you lose access to the admin password and don't have a linked Google
account, there are two paths back in:

1. **Linked Google.** If you linked Google from `/admin/account`, just
   sign in with Google, then change the password.
2. **Reset CLI.** If you have shell access to the server, run the
   reset-password CLI against the running container's mount:

   ```
   docker compose -f compose.prod.yaml exec web \
       bun run /app/bin/reset-password.ts --email you@example.com
   ```

   The CLI writes a new password hash directly into `.amber/auth.db`,
   revokes every existing session, and prints a temporary password to
   stdout once. Sign in with that password, then change it from
   `/admin/account`. The temporary password is single-use only because
   it's printed once — copy it somewhere safe before closing the shell.

There is no in-app forgot-password flow. Amber has no SMTP and won't
inherit one; the CLI is the deliberate escape hatch for the self-hoster
who already has shell access. If both options fail, the only remaining
recovery is to delete `.amber/auth.db` and re-bootstrap an admin (you
lose nothing else — content lives on the filesystem).

## Backing up `.amber/auth.db`

`.amber/cache.db` is regenerable: the loader rebuilds it from the
filesystem on cold start. `.amber/auth.db` is **not** — it holds the
admin row and session table. Your backup of the space directory needs to
cover the whole `.amber/` directory, not just markdown content.

The default `restic`/`rsync`/`tar`-of-the-space-dir pattern picks this up
automatically.

## Beyond this doc

- **Hardening.** SSH key-only authentication, a firewall (`ufw`),
  unattended security upgrades, fail2ban — your responsibility, not
  Amber's. Standard practice for any internet-facing server applies.
- **Backups.** Amber's data is the `spaces/<your-site>/` directory.
  Anything that backs up files works; production uses restic to Backblaze
  B2, but that's an operator choice, not Amber's prescription.
- **Monitoring.** Production uses UptimeRobot for liveness. No
  prescription beyond "you should know when your site is down."
- **Multi-space hosting.** Not yet supported. Coming in a future version.

Filesystem is the source of truth. Your space directory is the whole site.
Back that up; everything else regenerates.
