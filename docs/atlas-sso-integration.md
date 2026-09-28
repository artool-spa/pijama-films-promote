# PijamaFilms dashboard SSO — state of the integration

_Last updated: 2026-08-29 · branch `feat/atlas-sso` · everything below is measured, not assumed._

## A note on the name "Atlas"

**"Atlas" is this codebase's internal convention, not what the product is called.** The
dashboard was renamed to PijamaFilms months ago; Crazy Cake call it "el dashboard" and have
never used "Atlas" in any correspondence. The name survives here because it is baked into
env vars (`ATLAS_API_BASE_URL`, `ATLAS_LOGIN_ENABLED`), module paths (`src/lib/atlas/`),
route names (`/api/auth/atlas/session`) and Secret Manager entries, where renaming would mean
touching production configuration for no functional gain. It reached us through the handoff
envelope Crazy Cake still emits — `postMessage({ type: 'ATLAS_AUTH', token })` — and "Console"
came from their session cookie, `console-production`.

Keep it in code. **Do not use it when writing to Crazy Cake or to Pijama**: say "the dashboard"
or `dashboard.pijamafilms.com`.

## What this is

Single sign-on from the PijamaFilms dashboard (`dashboard.pijamafilms.com`, built by Crazy
Cake) into this platform. A producer clicks the marketing button there; the dashboard opens
`/auth` here in a popup and posts a JWT via `postMessage`; we exchange that token against the
dashboard's API, identify the partner, and mint our own session.

Full project history, contracts and measurements live in `coordination/pijama-sso/` on the
`coordination/pijama-sso` branch. This file is the summary a developer needs.

## Status: our half is complete and verified. The blockers are on Crazy Cake's side.

Verified with a real production token from a real partner account (2026-08-28):

| Piece | State |
|---|---|
| `/auth` landing page (pre-paint listener, buffering, origin allowlist) | ✅ built, tested |
| `POST /api/auth/atlas/session` (probe + login modes, stage taxonomy) | ✅ built, tested |
| Local simulator `/dev/atlas-simulator` (reproduces Console's real envelope) | ✅ built, tested |
| Token exchange against Atlas | ❌ blocked by Crazy Cake (see below) |
| `postMessage` from Console | ❌ blocked by Crazy Cake (see below) |

Suite: 584/584 across 40 files at `ad97dd6`.

## The two blockers (both measured on lab AND production)

1. **Console's `openMarketingPortal()` posts with `targetOrigin = window.location.origin`** —
   its own origin, not the portal's. The browser silently drops the message. One-line fix,
   theirs. Without it no handoff can work, whatever we deploy.
2. **`/movies/by-partner` sits behind a cookie session gate with no CORS.** Any caller
   without the `console-production` cookie gets a 302 — a valid `Bearer` token changes
   nothing. Unreachable from our server and from a cross-origin browser fetch alike.

Both were reported to Crazy Cake by email (scheduled 2026-08-31), together with three
options to unblock (session-gate exception / verify-token endpoint / RS256+JWKS) and the DNS
transition records.

## Security invariants — do not relax these

- **The token is opaque.** It is an HS256 JWT signed by Console. We cannot verify the
  signature (and must never hold the key — it is symmetric, holding it means being able to
  mint tokens for any partner). Authorizing from decoded claims would be a full auth bypass.
  The authoritative identity is Atlas's server response, nothing else.
- **Login is fail-closed.** `ATLAS_LOGIN_ENABLED` must be `"true"` and the partner must be
  named in `ATLAS_LOGIN_ALLOWED_PARTNER_IDS`. Empty allowlist = nobody. This is the only
  containment while `getFilms()` remains unscoped by partner (the other Go Live blocker).
- **Probe mode never mints a session and never creates partners.**
- **The token never reaches logs or responses** — length and prefix only. Header-unsafe
  tokens are rejected at `stage: 'input'` with the value masked.
- **The success banner follows `contractMatched`, never `ok`.** `ok` means "Atlas produced an
  HTTP response" (Contract D1, so diagnostics are never buried in an error); it does not mean
  the contract was honored.

## Env vars

```
ATLAS_API_BASE_URL                    server-side; Console host (prod: dashboard.pijamafilms.com)
NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS     baked at BUILD time — merging is not enough, needs a rollout
ATLAS_LOGIN_ENABLED                   "true" to allow login mode at all
ATLAS_LOGIN_ALLOWED_PARTNER_IDS       comma-separated; empty = login disabled for everyone
```

Missing `ATLAS_API_BASE_URL` reports `stage: 'config'` (HTTP 500) and says so on screen —
it must never be read as an Atlas failure.

## How to test without Crazy Cake

1. `yarn dev`, open `http://localhost:3000/dev/atlas-simulator`.
2. Get a real token: from a browser logged into Console **as a partner account** (an admin
   gets `UNAUTHORIZED`), run in the console:
   `await (await fetch('/partners/external-token', {headers:{'X-Requested-With':'XMLHttpRequest'}})).json()`
3. Paste the token (masked field), fire in **probe** mode, read the panel.

The simulator posts the envelope Console actually sends (`{ type, token }`, no `partner`) —
the shape labeled `console-shape`, measured 2026-08-28.
