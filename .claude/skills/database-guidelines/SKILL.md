# Database Guidelines

## Overview

The database is **Cloud Firestore**, reached through the Firebase Admin SDK. All
access lives in the model layer (`src/models/*.ts`); controllers and views never
touch it. There is no ORM, no migrations and no `DATABASE_URL`.

`docs/firestore-migration.md` records the collection layout and why each shape
was chosen.

## Access

```typescript
import { adminDb } from '@/lib/firebase/admin';
import { COLLECTIONS, IdSchema, docData, sanitize, compositeId } from '@/lib/firestore';

function partners() {
  return adminDb().collection(COLLECTIONS.partners);
}
```

`adminDb()` is a singleton over Application Default Credentials: the App Hosting
runtime service account in production, `gcloud auth application-default login`
locally. Never inline a service-account key.

The helpers in `@/lib/firestore` exist because three mismatches show up in every
model, and each one is a bug if handled ad hoc:

| Helper              | Why it exists                                                              |
| ------------------- | -------------------------------------------------------------------------- |
| `docData(snap)`     | Converts `Timestamp` → `Date` (recursively) and merges the id into the data |
| `sanitize(data)`    | Drops `undefined`, which Firestore rejects outright on write                |
| `compositeId(...)`  | Builds a deterministic id from a natural key, escaping the separator        |
| `IdSchema`          | Validates an id as a non-empty string, not a cuid                           |

## Document ids

Firestore has **no unique constraints**. A uniqueness requirement is expressed
as the document id:

```typescript
// email was UNIQUE -> it is the id
adminDb().collection(COLLECTIONS.userPreferences).doc(email);

// (filmId, language, variant) was a composite UNIQUE -> composite id
copies().doc(compositeId(filmId, language, variant));
```

Writing the same key twice overwrites instead of duplicating, which is the
behaviour the constraint used to guarantee. For a value that cannot be a key
(a platform-assigned id such as `metaAdId`), uniqueness is upheld by the single
code path that writes it.

## Defaults

Postgres filled in column defaults; Firestore stores exactly what it is given.
Every create must write the full document, or the output schema will reject it
on the next read:

```typescript
const document = {
  ...createDefaults(),   // archived: false, status: 'PENDING', width: null, ...
  ...sanitize(validated), // sanitized first: an absent optional field must fall
  createdAt: new Date(),  // back to its default, not overwrite it with undefined
};
```

That ordering matters. `{...defaults, ...validated}` with `validated.width ===
undefined` overwrites the default with `undefined`, `sanitize` then drops the
key, and the document comes back missing a required field.

## Relations

There are no joins. `src/models/hydrate.ts` assembles the campaign graph with a
bounded fan-out — one query per batch of parents, then one `getAll` for the
distinct children:

```typescript
const campaigns = await campaignDocs(query);
const hydrated = await withAds(campaigns);      // campaign -> ads -> images/videos
const withOwner = await withPartner(campaigns); // campaign -> partner
```

Use these rather than reading children per parent: a loop of `await` inside
`map` is one round trip per ad, which is what makes a naive port slow.

Many-to-many is an array of ids on the owning document (`imageIds`,
`videoIds`), and the reverse lookup is `array-contains`.

## Queries

```typescript
// equality, array membership, ordering
collection.where('filmMuviUuid', '==', uuid).where('archived', '==', false)
collection.where('platforms', 'array-contains', 'GOOGLE')
collection.where('campaignId', 'in', batch)   // max 30 values — chunk beyond that
```

Prefer filtering a **small** result set in memory over adding an inequality to
the query. `where('status', '!=', 'DRAFT')` forces the first `orderBy` onto
`status` and demands a composite index; a film has a handful of campaigns, so
`docs.filter(...)` is both cheaper and clearer. Say so in a comment when you do
it, and reach for the index when the collection is genuinely large.

## Aggregations

Server-side, reading index entries rather than documents:

```typescript
const { count } = (await query.count().get()).data();

const totals = (
  await campaigns
    .where('status', '!=', 'DRAFT')
    .aggregate({ budget: AggregateField.sum('budget'), count: AggregateField.count() })
    .get()
).data();
```

Never sum by fetching every document and reducing in JavaScript.

## Transactions

Use one whenever a write depends on a value that was just read — balances,
idempotency checks, "create if absent". Firestore retries a transaction whose
reads were invalidated by a concurrent write, which is what makes the balance
arithmetic safe.

**All reads must precede all writes:**

```typescript
await adminDb().runTransaction(async (tx) => {
  // ---- reads ----
  const account = await tx.get(accountRef);
  const existing = await tx.get(bySessionQuery(sessionId));

  if (existing.docs[0]?.data().status === 'COMPLETED') return existing.docs[0];

  // ---- writes ----
  tx.update(accountRef, { balance: newBalance });
  tx.set(ledgerRef, entry);
});
```

For several independent writes that must land together, use a batch
(`adminDb().batch()`, max 500 writes).

## Indexes and rules

Composite indexes live in `firestore.indexes.json`, security rules in
`firestore.rules`. Deploy both with:

```bash
npm run deploy:firestore
```

Add an index when a query needs one — never widen a rule to make a query work.
Collection-group queries (for example finding a ledger entry by Stripe session
across all accounts) need an explicit `COLLECTION_GROUP` entry; the automatic
single-field indexes do not cover them.

## Testing

`src/test/firestore-fake.ts` is an in-memory Firestore covering the slice of the
API the models use. Mock the SDK at the module boundary:

```typescript
const db = new FakeFirestore();
vi.mock('@/lib/firebase/admin', () => ({ adminDb: () => db }));

beforeEach(() => db.reset());
```

Tests then exercise the real model logic — balances, idempotency, ordering,
hydration — instead of asserting that a mock was called. Never point a test at
the production database.

## Error Handling

Let Zod parse errors and Firestore errors propagate to the route or server
component, which decides the response. Do not leak internal details to users:
log the cause, return a plain message.
