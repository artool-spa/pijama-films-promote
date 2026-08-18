# Postgres → Firestore migration

Firebase App Hosting hosts the app; Firestore replaces Postgres as the database.
Cloud SQL is not part of the target architecture.

The model layer (`src/models/*.ts`) is the only seam that touches the database:
every model exports functions that validate their result with Zod. The port
kept those signatures and schemas identical, so controllers (`page.tsx`) and
views (`client.tsx`) were never touched — which is what allowed the models to
move one at a time, with the rest of the app still running on Prisma in between.

## Data model

| Postgres model       | Firestore                                       | Document id |
| -------------------- | ----------------------------------------------- | ----------- |
| `UserPreference`     | `userPreferences/{email}`                        | email |
| `Partner`            | `partners/{id}`                                  | auto |
| `Campaign`           | `campaigns/{id}`                                 | auto |
| `Ad`                 | `ads/{id}`                                       | auto |
| `Image`              | `images/{id}`                                    | auto |
| `Video`              | `videos/{id}`                                    | auto |
| `GeneratedCopy`      | `generatedCopies/{filmId__language__variant}`    | composite |
| `Account`            | `accounts/{partnerId}`                           | partner id |
| `AccountTransaction` | `accounts/{accountId}/transactions/{id}`         | auto |

Decisions behind that table:

- **Uniqueness becomes the document id.** Firestore has no unique constraints.
  `UserPreference.email` and `GeneratedCopy(filmId, language, variant)` are
  natural keys, so they *are* the id — writing the same key twice overwrites.
  The remaining unique columns (`metaCampaignId`, `storageKey`,
  `stripeSessionId`, …) are platform-assigned values looked up by query; they
  are enforced by the code paths that write them, not by the database.
- **Ids are validated as non-empty strings**, not cuids. New documents get
  Firestore auto-ids; rows migrated from Postgres keep their cuid, and both pass.
- **Many-to-many `Ad ↔ Image/Video`** becomes `imageIds: string[]` /
  `videoIds: string[]` on the ad document. `array-contains` covers the reverse
  lookup.
- **An account is keyed by its partner.** One account per partner was a unique
  column; here it is the document id, which also turns every lookup into a
  direct read.
- **`AccountTransaction` is a subcollection** of its account: it is always read
  through the account, and the account document is the transaction boundary for
  balance updates. Cross-account reporting uses a collection-group query.
- **Small collections sort in memory.** Where a film holds at most a few dozen
  documents, the query filters on one field and sorts in JavaScript, which
  avoids a composite index without any practical cost.

## Phases

- [x] **0. Infrastructure** — Firestore database in `pijama-promote-firebase`
      (us-central1), TTL policy on `events.expiresAt`, security rules deployed,
      20 secrets in Secret Manager, `apphosting.yaml`.
- [x] **1. Foundation** — `src/lib/firestore/index.ts`: collection names,
      `Timestamp` → `Date` conversion, `undefined` stripping, composite ids.
- [x] **2. Self-contained models** — `userPreference`, `generatedCopy`.
- [x] **3. Assets** — `image`, `video`.
- [x] **4. Campaign graph** — `partner`, `campaign`, `ad`, the aggregate
      helpers in `film`, the auth middleware and the four insight API routes.
      The nested `include:` became `src/models/hydrate.ts`.
- [x] **5. Billing** — `account` and its ledger, on Firestore transactions over
      the account document.
- [x] **6. Indexes** — `firestore.indexes.json`, deployed.
- [x] **7. Data** — the environment starts empty; the only records carried over
      are the users, via `scripts/firestore-import-partners.ts`.
- [x] **8. Cleanup** — Prisma, the `prisma/` directory, the `#prisma` alias,
      `DATABASE_URL` and the local Postgres container are gone.

## Notes

- Firestore transactions must perform all reads before any write, and retry on
  contention. The balance updates in phase 5 are single-document transactions,
  which is the case Firestore handles best.
- Aggregations (`_sum`, `_count`) have server-side equivalents
  (`getAggregateFromServer`); they are not client-side loops.
- `BigInt` (`Campaign.targetCpvMicros`) has no Firestore equivalent. It is
  stored as a number: the value is micros of currency, far below 2^53.

## Environment

`pijama-promote-firebase`, backend `pijama-promote` (us-central1):

- **Firestore** in us-central1, rules and indexes deployed, TTL policy active on
  `events.expiresAt`.
- **Assets** in `gs://pijama-promote-assets`: uniform bucket-level access,
  `allUsers` granted `objectViewer` because Meta and Google fetch the creatives
  directly, runtime service account granted `objectAdmin`.
- **Credentials**: storage, Firestore and Vertex AI all use Application Default
  Credentials — the runtime service account. No static service-account key is
  injected; `GCS_SERVICE_ACCOUNT_KEY_JSON` is no longer referenced.
- **Secrets**: 19 referenced by name from `apphosting.yaml`; values live in
  Secret Manager. `SESSION_SECRET` and `CRON_SECRET` were generated fresh for
  this environment rather than copied from production.

Still open, and outside the migration itself:

- **Users have to be provisioned.** The app has two authentication paths:

  1. *Provisional* — Firebase Auth with email and password. The browser signs
     in against Firebase, posts the ID token to `/api/auth/login`, and the
     server exchanges it for a session cookie. No account exists in any project
     yet, because Firebase Auth is new in this branch.
  2. *Final* — the Pijama Films integration, which needs `PIJAMA_CLIENT_ID` and
     `PIJAMA_CLIENT_SECRET` (see below).

  Both authorize off the `partnerId` custom claim, and both need the matching
  `partners/{id}` document: a user whose claim points at no partner signs in
  and then sees nothing. `npm run user:provision` writes the account, the claim
  and the partner document together so they cannot drift apart. It prints a
  one-time reset link by default; `--password-stdin` sets a password directly,
  read from stdin rather than from an argument.

- **Seed data.** `npm run db:seed` creates the `pijamafilms` partner — the one
  `isSpecialPartner()` and `firestore.rules` grant access to every film. It
  replaces the old `prisma/seed.ts`. Not yet run against the new project: the
  Admin SDK needs `gcloud auth application-default login`, which is separate
  from `gcloud auth login`.
- **Stripe webhook**: the copied `STRIPE_WEBHOOK_SECRET` belongs to another
  endpoint. Create the endpoint for this backend and push the new `whsec_`.
- **`PIJAMA_CLIENT_ID` / `PIJAMA_CLIENT_SECRET`** (`src/lib/pijama/index.ts`)
  are configured nowhere — not in Secret Manager, not in any `.env`. They gate
  the final authentication path, so until they exist only the provisional
  email-and-password flow works. Once you have them, push them as secrets and
  add the two entries to `apphosting.yaml`.
