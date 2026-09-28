# PijamaFilms dashboard SSO — state of the integration

_Last updated: 2026-09-28 · everything below is measured, not assumed, and dated where it matters._

## A note on the name "Atlas"

**Atlas was this product's original name.** It was renamed to PijamaFilms partway through the
project, and Crazy Cake now call it "el dashboard". The old name survives in this codebase
because it is baked into env vars (`ATLAS_API_BASE_URL`, `ATLAS_LOGIN_ENABLED`), module paths
(`src/lib/atlas/`), route names (`/api/auth/atlas/session`), Secret Manager entries, and into
the handoff envelope the dashboard still emits — `postMessage({ type: 'ATLAS_AUTH', token })`.
Their session cookie is still `console-production`, which is where "Console" came from.

Renaming all that would mean touching production configuration for no functional gain, so the
convention stays in code. **Do not use it when writing to Crazy Cake or to Pijama** — say "the
dashboard" or `dashboard.pijamafilms.com`. We used the retired name in correspondence for
months; nobody corrected us, which is not the same as it being right.

## What this is

Single sign-on from the PijamaFilms dashboard (`dashboard.pijamafilms.com`, built by Crazy
Cake) into this platform. A producer clicks the marketing button there; the dashboard opens
`/auth` here in a new window and posts a JWT via `postMessage`; we exchange that token against
the dashboard's API, identify the partner, and mint our own session.

**At Go Live, SSO is the only access path** (decided 2026-09-28). The five email/password
accounts are test accounts and do not represent a supported route.

Full project history, contracts and measurements live in `coordination/pijama-sso/` on the
`coordination/pijama-sso` branch. This file is the summary a developer needs.

## Status

Our half is built, deployed and verified in production. Both of the August blockers were
fixed by Crazy Cake in September.

| Piece | State |
|---|---|
| `/auth` landing page (pre-paint listener, buffering, origin allowlist) | ✅ built, tested |
| `POST /api/auth/atlas/session` (probe + login modes, stage taxonomy) | ✅ built, tested |
| Local simulator `/dev/atlas-simulator` | ✅ built, tested |
| `targetOrigin` fix in the dashboard's bundle | ✅ fixed by Crazy Cake, confirmed 2026-09-03 |
| Token exchange against the dashboard's API | ✅ session-gate exception applied (option A), HTTP 200 |
| Full login in production (token → partner → session → `/films`) | ✅ verified 2026-09-17 |
| Marketing button in production | ❌ never worked — see below |
| Partner scoping of `getFilms()` | ❌ the Go Live blocker |
| Reading the assigned films from MUVI | ❌ open question with Crazy Cake |

Suite: 622 passed across 46 files at `b7705e1`.

## What is open

### 1. The Marketing button in production opens the wrong URL

The dashboard's production config has `marketingUrl = https://promote.pijamafilms.com`, with
no `/auth`. Read straight from their Vue store on 2026-09-23:

```js
const root = document.querySelector('#app') ?? document.body.firstElementChild;
JSON.stringify(root.__vue__.$store.state).match(/"[^"]*[Mm]arketing[^"]*":"[^"]*"/g);
// → ['"marketingUrl":"https://promote.pijamafilms.com"']
```

The fix landed in testing on 2026-09-03 and never reached production. **What we verified on
2026-09-17 was the token exchange and session minting, not the button**, so this went unnoticed
for six weeks.

Diagnosing it needs no access to their config: `/auth` is a public route and never redirects to
`/login` — on failure it renders its diagnostic panel. So a click that lands on `/login` can
only mean the window opened the site root, which the middleware bounces. Asked 2026-09-28.

The `_blank` change was never applied either: the handoff still opens a fixed 1200×800 popup.
Cosmetic, and it does not affect the handshake.

### 2. The assigned films cannot be read from MUVI

Crazy Cake assigned two Fábula films (Fuga, Tony Manero) to the partner on 2026-09-23. The
dashboard shows both as published and returns their `muviContentUuid`. MUVI, queried with our
credentials, will not serve either — measured 2026-09-23:

| uuid | MUVI's answer |
|---|---|
| a known live title | found, and present in the catalogue listing |
| `35cf6b4d…` (Fuga) | `This content is not available in your region` |
| `bd71229b…` (Tony Manero) | `This content is not available in your region` |
| `ffffffff…` (invented) | `The content you're looking for is no longer available` |

**The invented uuid produces a different message from the two real ones**, which is what proves
`muviContentUuid` carries a genuine MUVI content uuid rather than an identifier internal to the
dashboard. Neither film appears in the 98-title catalogue, and the region message repeats from
Chilean, US and other IPs, so it is not our address.

It is not a credentials problem: the catalogue we read is Pijama's, and other Fábula titles are
in it — Ema, Neruda, No, Post Mortem, Gloria, A Fantastic Woman. From outside we cannot tell
whether these two were never published to the store, are territory-restricted, or live in a
different store. Asked 2026-09-28, together with a request to assign a title that is live.

**Nothing has yet been observed where both halves are visible at once** — a film whose
`muviContentUuid` from the dashboard matches a `content_uuid` we can read from MUVI. Until that
happens the mapping is supported by format and by the error-message control, not by a match.

### 3. `getFilms()` is not scoped by partner

Still the Go Live blocker. `getFilms()` pages MUVI's whole catalogue and MUVI cannot filter by
partner — measured with three arms and a control (`scripts/muvi-partner-scope-check.ts`). The
single-entry allowlist is the only thing containing it.

Since the dashboard's response is partner-scoped by construction and now carries title, year,
genre, duration, price, trailer and assets, sourcing the producer's film list from there instead
of MUVI would close both this and the reading problem. It remains a decision, not a plan: the
film still has to be live in MUVI for the ads to have a destination, because campaigns point at
`https://pijamafilms.com/watch/{content_uuid}` (`src/models/film.ts:438`).

## The `movies[]` contract changed in production

Around 2026-09-23 the shape changed without prior notice; Crazy Cake documented it the same day
and the documentation matches what we measured, key for key — the first time in this integration
that those two agreed.

```
_id, muviContentUuid, originalTitle, internationalTitle, description, genre,
year, duration, language, ageRating, price, trailerUrl, assets, publishedAt, updatedAt
```

Gone: `muviUuid`, `status`, `createdAt`. The old `movies[].muviUuid` used to carry the
**partnerId**, identical across every film of a partner — an artifact Crazy Cake acknowledged
on 2026-09-17.

**Why it did not break us:** `AtlasMovieSchema` is `z.object({}).passthrough()`
(`src/lib/atlas/types.ts:40`), so films pass through unvalidated; only the `partner` object is
checked strictly, and it was untouched. **What it did break:** `movieSample` in the diagnostics
reads `title` and `muviUuid` (`toMovieSample`, `src/lib/atlas/types.ts:158`), both now absent, so that table in
the probe panel renders blank. Cosmetic, and worth fixing when the contract settles.

`muviContentUuid` is only populated once the film is published in MUVI (Crazy Cake, 2026-09-23),
which is why the two test films uploaded in the lab never carried it — the lab has publishing
blocked, because MUVI has no test environment and publishing there would publish for real.

## Security invariants — do not relax these

- **The token is opaque.** It is an HS256 JWT signed by the dashboard. We cannot verify the
  signature, and must never hold the key — it is symmetric, so holding it means being able to
  mint tokens for any partner. Authorizing from decoded claims would be a full auth bypass.
  The authoritative identity is the dashboard's server response, nothing else.
- **Login is fail-closed.** `ATLAS_LOGIN_ENABLED` must be `"true"` and the partner must be named
  in `ATLAS_LOGIN_ALLOWED_PARTNER_IDS`. Absent or empty allowlist = nobody. This is the only
  containment while `getFilms()` remains unscoped.
- **Never set an empty `value: ""` in `apphosting.yaml`.** App Hosting rejects it and the whole
  build fails naming the file and not the line; that is what broke `build-2026-09-01-001`. To
  mean "nobody", remove the entry.
- **Probe mode never mints a session and never creates partners.**
- **The token never reaches logs or responses** — length and prefix only. Header-unsafe tokens
  are rejected at `stage: 'input'` with the value masked.
- **The success banner follows `contractMatched`, never `ok`.** `ok` means the dashboard produced
  an HTTP response (Contract D1, so diagnostics are never buried in an error); it does not mean
  the contract was honored.
- **Asset URLs are unsigned.** `muviUrl` serves the master file from CloudFront with no signature
  or expiry, verified unauthenticated. Crazy Cake confirmed on 2026-09-17 that MUVI's uploader
  supports neither, so this is a known and accepted exposure, not an oversight.

## Env vars

```
ATLAS_API_BASE_URL                    server-side; dashboard host (prod: dashboard.pijamafilms.com)
NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS     baked at BUILD time — merging is not enough, needs a rollout
ATLAS_LOGIN_ENABLED                   "true" to allow login mode at all
ATLAS_LOGIN_ALLOWED_PARTNER_IDS       comma-separated; absent = login disabled for everyone
```

Currently allowed: `6984824e65c8a085b5d5a632` — jpundurraga@artool.cl, the in-house operator,
deliberately the only entry. The same partner id and the same `muviUuid` are returned in both
lab and production; the environments are isolated for authentication (a lab token gets 401 from
production) but share the partner identity, which is why one entry covers both.

Missing `ATLAS_API_BASE_URL` reports `stage: 'config'` (HTTP 500) and says so on screen — it must
never be read as a dashboard failure.

## How to test without Crazy Cake

1. `yarn dev`, open `http://localhost:3000/dev/atlas-simulator`.
2. Get a real token from a browser logged into the dashboard **as a partner account** (an admin
   gets `UNAUTHORIZED`). Treat it as a production credential: do not paste it into a chat or a
   file. The runbook in `coordination/pijama-sso/runbook-click-through.md` has a snippet that
   puts it into a masked field.
3. Paste the token, fire in **probe** mode, read the panel.

To check the partner's films without leaving the browser, run this in a dashboard tab — the
token stays in a local variable and is never printed:

```js
const t = (await (await fetch('/partners/external-token',
  { headers: { 'X-Requested-With': 'XMLHttpRequest' } })).json()).token;
const r = await (await fetch('/movies/by-partner',
  { headers: { Authorization: `Bearer ${t}` } })).json();
console.table(r.data.movies.map((m) => ({ _id: m._id, t: m.originalTitle, u: m.muviContentUuid })));
```

The simulator posts the envelope the dashboard actually sends (`{ type, token }`, no `partner`) —
the shape labeled `console-shape`, measured 2026-08-28.
