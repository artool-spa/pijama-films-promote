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

### 2. The assigned films and MUVI: geoblocking, and duplicate records

Crazy Cake assigned Fuga and Tony Manero to the partner on 2026-09-23 in production, and Neruda
and Ema on 2026-09-30 in testing. Queried with our credentials from a Chilean IP, measured
2026-10-02:

| title | `muviContentUuid` from the dashboard | MUVI's answer |
|---|---|---|
| Neruda | `a939ac9caba041fd8f598139820d45be` | found, **same uuid**, full details |
| Ema | `e248bd4803b740a68deb2241c9670076` | code 400 — not available in your region |
| Tony Manero | `35cf6b4d385c44fdb625d747af8ca1a3` | code 400 — not available in your region |
| Fuga | `bd71229bb0df4499a7e8649a867d2e47` | code 400 — not available in your region |
| `ffffffff…` (invented, the control) | — | code 1317 — no longer available |

An earlier revision of this table had Fuga's and Tony Manero's uuids swapped. The values above
are what the lab dashboard returns; the production dashboard was never re-checked after the
correction, so confirm there before relying on it.

**Neruda settles the mapping.** The uuid the dashboard hands us is byte-for-byte the uuid MUVI
serves, and the record hydrates completely — title, description, 107 min, 2016, Pablo Larraín,
poster, banner, trailer. This is the first time both halves have been visible at once; until
2026-10-02 the mapping rested on format and on the error-message control alone.

**The 400 is geoblocking**, not a broken uuid. Crazy Cake confirmed it on 2026-09-30: the store
has geoblocking on, and a request from a blocked country gets exactly that message. The control
still matters — a real-but-blocked uuid answers 400, an invented one answers 1317 — so the two
failures remain distinguishable. Note what this costs us: a producer promoting a film has no
reason to sit in a country where that film is licensed, so **querying MUVI from the user's IP
can never be the way to build a producer's film list**.

**There are two "Ema" records in the store, and that is by design.** The uuid the dashboard
returns (`e248bd48…`) is geoblocked; a *different* Ema (`c009c426…`, created 2026-07-16) sits in
the catalogue we can read. Same store, same `content_created_by` (`2cfaa272…`), two records.

Josefina Valdivia (Fábula) explained it on 2026-10-05: producers and distributors holding rights
in different territories may share a film's assets, and when they choose not to, each uploads
their own version. For Ema they did not share — the second upload carries its own logos. In
other cases (Asako I&II) the video assets *are* shared and only the geoblocking parameters
differ.

Three consequences, and they are the reason this section matters more than the 400s:

1. **Matching by title is unusable**, permanently and by the business's own design — not as a
   data-quality problem someone will eventually clean up.
2. **The catalogue contains other rights holders' copies of a producer's own film.** Combined
   with §3 below, a producer browsing the 98-title list can reach the wrong record of their own
   film. Ema is that case, in the catalogue, today.
3. **Asset URLs cannot be used to tell two records apart either**, because Asako I&II shows two
   records legitimately sharing them.

Only the `muviContentUuid` the dashboard returns for that producer is authoritative.

**Director and cast come from MUVI**, not from the dashboard: `cast_details` on the same
`contentList` call carries typed entries (Actor, Writer, Producer, Director) and is what the
Pijama dashboard itself displays. Measured on Neruda, 2026-10-06. The catch is that it only
works for records MUVI will serve us — a geoblocked uuid returns nothing at all, so sourcing the
film list from the dashboard and then enriching it from MUVI comes up empty for precisely the
films that need it.

### 3. `getFilms()` is not scoped by partner

Still the Go Live blocker. `getFilms()` pages MUVI's whole catalogue and MUVI cannot filter by
partner — measured with three arms and a control (`scripts/muvi-partner-scope-check.ts`). The
single-entry allowlist is the only thing containing it.

Since the dashboard's response is partner-scoped by construction and now carries title, year,
genre, duration, price, trailer and assets, sourcing the producer's film list from there instead
of MUVI would close both this and the reading problem. It remains a decision, not a plan: the
film still has to be live in MUVI for the ads to have a destination, because campaigns point at
`https://pijamafilms.com/watch/{content_uuid}` (`src/models/film.ts:438`).

What §2 added on 2026-10-05 raises the stakes of leaving this open. The catalogue does not just
contain *other producers'* films — it contains other rights holders' copies of **this**
producer's film, indistinguishable by title and sometimes even by assets. The failure mode is no
longer "sees too much"; it is "promotes the wrong record of their own film, to the wrong
territory". The dashboard-sourced list is the only version of this that is correct by
construction rather than by containment.

The open ask to Crazy Cake, unanswered as of 2026-10-07, is to expose that same
producer-to-films relation to our server with our own credentials, without the browser session
token — today the list only exists for us while the producer is inside Promote.

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
