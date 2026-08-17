# Postgres → Firestore migration

Firebase App Hosting hosts the app; Firestore replaces Postgres as the database.
Cloud SQL is not part of the target architecture.

The model layer (`src/models/*.ts`) is the only seam that touches the database:
every model exports functions that validate their result with Zod. The port
keeps those signatures and schemas identical, so controllers (`page.tsx`) and
views (`client.tsx`) are untouched. Models can therefore be moved one at a time
while the rest of the app still runs on Prisma.

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
| `Account`            | `accounts/{id}`                                  | auto |
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
- [ ] **3. Assets** — `image`, `video`. Independent of the campaign graph.
- [ ] **4. Campaign graph** — `partner`, `campaign`, `ad`, plus the four
      insight API routes. The 44 `include:` become explicit fan-out reads; this
      is where the read-shape work sits.
- [ ] **5. Billing** — `account` and its transactions. Four Prisma
      `$transaction` blocks become Firestore transactions on the account
      document. Left last on purpose: it is the only place where a wrong
      concurrent write costs money.
- [ ] **6. Indexes** — composite indexes in `firestore.indexes.json` for the
      queries phases 3–5 introduce.
- [ ] **7. Data migration** — export from Cloud SQL, import into Firestore,
      preserving ids. Only needed if the existing production data must be
      carried over; not yet decided.
- [ ] **8. Cleanup** — drop `prisma/`, `@prisma/client`, the `#prisma` import
      alias and `DATABASE_URL`; update `CLAUDE.md` and the database skill.

## Notes

- Firestore transactions must perform all reads before any write, and retry on
  contention. The balance updates in phase 5 are single-document transactions,
  which is the case Firestore handles best.
- Aggregations (`_sum`, `_count`) have server-side equivalents
  (`getAggregateFromServer`); they are not client-side loops.
- `BigInt` (`Campaign.targetCpvMicros`) has no Firestore equivalent. It is
  stored as a number: the value is micros of currency, far below 2^53.
