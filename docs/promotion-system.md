# Promotion System Documentation

## Overview

Pijama Films allows film producers to create and manage advertising campaigns across **Meta (Facebook/Instagram)** and **Google Ads (Demand Gen)**. The system handles the full lifecycle: campaign creation, asset upload and validation, platform sync, real-time progress tracking, metrics collection, and billing.

### Architecture

```
Producer (UI)
    │
    ├── Upload assets ──────────────► GCS (Google Cloud Storage)
    │                                    │
    │                                    ▼
    │                              Background validation
    │                              (dimensions, eligibility)
    │                                    │
    │                                    ▼
    │                              SSE event → UI update
    │
    ├── Create campaign ────────────► Database (DRAFT)
    │                                    │
    │                                    ▼
    │                              Budget validation
    │                              Account balance check
    │                                    │
    │                                    ▼
    ├── Sync to platforms ──────────► syncCampaignToMeta()
    │                               ► syncCampaignToGoogle()
    │                                    │
    │                           ┌────────┴────────┐
    │                           ▼                  ▼
    │                      Meta Ads API      Google Ads API
    │                      (CBO + DCO)       (Demand Gen)
    │                           │                  │
    │                           ▼                  ▼
    │                      Facebook            YouTube
    │                      Instagram           Discover
    │                                          Gmail
    │
    └── View insights ──────────────► Platform APIs (cached)
```

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/campaigns/sync.ts` | Core sync logic for Meta and Google |
| `src/lib/meta/api.ts` | Meta Ads API operations |
| `src/lib/google/api.ts` | Google Ads API operations |
| `src/models/campaign.ts` | Campaign CRUD and status management |
| `src/models/ad.ts` | Ad CRUD with image/video relations |
| `src/lib/campaigns/budget-validation.ts` | Budget minimum calculations |
| `src/lib/events/` | SSE real-time event system |

---

## Campaign Lifecycle

```
DRAFT ──► PENDING_ASSETS ──► PENDING ──► ACTIVE ──► PAUSED
  │              │                │          │          │
  │              │                │          │          │
  └──────────────┴────────────────┴──────────┴──────────┴──► ARCHIVED
                                                        └──► ERROR
```

| Status | Description |
|--------|-------------|
| `DRAFT` | Campaign created locally, not synced to any platform |
| `PENDING_ASSETS` | Campaign saved but waiting for video uploads to complete (metaVideoId or youtubeVideoId not yet set) |
| `PENDING` | Campaign synced to platform, awaiting platform approval |
| `ACTIVE` | Campaign running on ad platforms |
| `PAUSED` | Campaign paused by user or system |
| `ARCHIVED` | Campaign ended or archived |
| `ERROR` | Sync or platform error occurred |

### Status Transitions

- **DRAFT → PENDING_ASSETS**: When `create-and-sync` is called but videos are still uploading
- **PENDING_ASSETS → PENDING**: Cron job detects assets are ready and syncs to platform
- **DRAFT → PENDING**: When `create-and-sync` is called and all assets are already ready
- **PENDING → ACTIVE**: Platform approves the campaign (tracked externally)
- **Any → ERROR**: Sync failure or platform API error

---

## Platform: Meta (Facebook / Instagram)

### Integration Overview

| Detail | Value |
|--------|-------|
| API Version | v24.0 |
| Base URL | `https://graph.facebook.com` |
| Auth | Long-lived access token (60-day expiry, manual refresh) |
| Library | `src/lib/meta/` |
| Env vars | `META_ACCESS_TOKEN`, `META_AD_ACCOUNT_ID`, `META_PIXEL_ID`, `META_PAGE_ID`, `META_API_VERSION` |

### Campaign Structure (CBO)

Meta campaigns use **Campaign Budget Optimization (CBO)** with dynamic creative:

```
Campaign (budget at this level)
├── Image AdSet (if campaign has images)
│   └── Dynamic Creative Ad
│       ├── Up to 5 headlines
│       ├── Up to 5 primary texts (bodies)
│       ├── Up to 5 descriptions
│       ├── Multiple image URLs
│       └── Call to action
│
└── Video AdSet (if campaign has videos)
    └── Dynamic Creative Ad
        ├── Up to 5 headlines
        ├── Up to 5 primary texts (bodies)
        ├── Up to 5 descriptions
        ├── Multiple video IDs
        └── Call to action
```

Meta automatically tests combinations and optimizes delivery toward the best-performing creative variants.

### Sync Flow (`syncCampaignToMeta`)

1. **Validate** Meta configuration (PAGE_ID required)
2. **Collect media** from all ads — deduplicate image URLs and video IDs
3. **Upload videos** to Meta if `metaVideoId` not already set (`uploadAdVideo`)
4. **Build targeting** from campaign config (countries, age, gender, genres, LGBT, saved audiences)
5. **Create CBO Campaign** with 1-2 AdSets via `createCBOCampaignWithAdSets`:
   - Map objective: `CONVERSIONS → OUTCOME_SALES`, `LANDING_PAGE_VIEW → OUTCOME_TRAFFIC`
   - Map optimization goal: `CONVERSIONS → OFFSITE_CONVERSIONS`, `LANDING_PAGE_VIEW → LANDING_PAGE_VIEWS`
   - Budget sent in cents: `Math.round(campaign.budget * 100)`
6. **Create Dynamic Creative Ads** — one per AdSet (image ad, video ad)
7. **Mark synced** in database with metaCampaignId, imageAdSetId, videoAdSetId
8. **Emit SSE events** at each step (30%, 40%, 60%, 70%, 85%, 95%, 100%)

### Targeting

Built via `buildTargeting()` using saved audiences stored in Meta:

| Parameter | Description |
|-----------|-------------|
| `countries` | ISO country codes array |
| `ageMin` / `ageMax` | Age range (18-65+) |
| `genders` | `1` = male, `2` = female |
| `includeBaseAudiences` | Include saved audiences prefixed `BASE +` |
| `filmGenres` | Match saved audiences prefixed `GENEROS CINEMATOGRAFICOS +` |
| `includeLgbtAudience` | Include saved audience named `LGBT` |

Output targeting structure:
```json
{
  "geo_locations": { "countries": ["US", "CL"] },
  "age_min": 18,
  "age_max": 65,
  "genders": [1, 2],
  "flexible_spec": [{ "interests": [...], "behaviors": [...] }]
}
```

Saved audiences are fetched from Meta and cached for 5 minutes.

### Objectives

| Campaign Objective | Meta Objective | Optimization Goal | Promoted Object |
|-------------------|---------------|-------------------|-----------------|
| `CONVERSIONS` | `OUTCOME_SALES` | `OFFSITE_CONVERSIONS` | pixel_id + PURCHASE |
| `LANDING_PAGE_VIEW` | `OUTCOME_TRAFFIC` | `LANDING_PAGE_VIEWS` | None |

### Insights

**Endpoint**: `GET /api/meta/campaigns/[id]/insights`

**Caching**:
- Active campaigns: 1-hour TTL
- Completed campaigns: 24-hour TTL
- Two separate caches: regular insights and platform breakdown

**Query parameter**: `?breakdown=platform` for per-platform metrics

**Metrics collected**: impressions, clicks, spend, reach, frequency, cpm, cpc, ctr, conversions (purchase/omni_purchase actions), cost per conversion

**Platform breakdown labels**: Facebook, Instagram, Audience Network, Messenger

### Ad Preview

**Endpoint**: `GET /api/meta/ads/[id]/preview`

Generates a visual preview of the ad creative using Meta's `generatepreviews` endpoint.

### Meta API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/meta/campaigns` | Create campaign |
| POST | `/api/meta/campaigns/create-and-sync` | Create campaign + ads + auto-sync |
| GET | `/api/meta/campaigns/[id]` | Get campaign details |
| POST | `/api/meta/campaigns/[id]` | Update campaign |
| POST | `/api/meta/campaigns/[id]/sync` | Manual sync to Meta |
| GET | `/api/meta/campaigns/[id]/insights` | Fetch metrics (cached) |
| POST | `/api/meta/ads/[id]` | Update ad |
| GET | `/api/meta/ads/[id]/preview` | Generate ad preview |
| GET | `/api/meta/audiences` | List saved audiences |
| GET | `/api/meta/locations` | Location targeting data |

---

## Platform: Google Ads (Demand Gen)

### Integration Overview

| Detail | Value |
|--------|-------|
| API | Google Ads REST API (via Mutate + GAQL) |
| Base URL | `https://googleads.googleapis.com` |
| Auth | OAuth2 with automatic token refresh |
| Library | `src/lib/google/` |
| Env vars | `GOOGLE_ADS_DEVELOPER_TOKEN`, `GOOGLE_ADS_CLIENT_ID`, `GOOGLE_ADS_CLIENT_SECRET`, `GOOGLE_ADS_REFRESH_TOKEN`, `GOOGLE_ADS_CUSTOMER_ID`, `GOOGLE_ADS_LOGIN_CUSTOMER_ID` |

### Campaign Structure (Demand Gen)

Google campaigns use **Demand Gen** format with image ads:

```
Campaign (budget at this level)
└── Ad Group
    └── Demand Gen Multi-Asset Image Ad
        ├── Up to 5 headlines (max 30 chars each)
        ├── Up to 5 descriptions (max 90 chars each)
        ├── Multiple image assets (uploaded as base64)
        ├── Final URL (landing page)
        ├── Business name (max 25 chars)
        └── Call to action
```

Ads are served across YouTube, Discover feed, and Gmail.

### Sync Flow (`syncCampaignToGoogle`)

1. **Build targeting** from campaign config (geo targets, age, gender, custom audiences)
2. **Create Demand Gen Campaign** with AdGroup via `createDemandGenCampaignWithAdGroup`:
   - Budget in currency units (dollars, not cents)
   - Bidding strategy: defaults to `MAXIMIZE_CLICKS`
   - Campaign starts in PAUSED state
3. **Upload image assets** to Google Ads — download from URL, convert to base64, upload via asset mutate
4. **Create Demand Gen Image Ads** — one per ad with multiple images
5. **Enable campaign and ad group** after successful ad creation via `updateCampaignStatus` and `updateAdGroupStatus`
6. **Mark synced** in database with googleCampaignId, googleAdGroupId, googleEntityStatus
7. **Emit SSE events** at each step (40%, 60%, 70%, 80%, 90%, 100%)

### Targeting

Built via `buildGoogleTargeting()` using custom audiences stored in Google Ads:

| Parameter | Description |
|-----------|-------------|
| `countries` | ISO codes mapped to geo target constants (e.g., `US → 2840`) |
| `ageMin` / `ageMax` | Mapped to Google ranges: 18-24, 25-34, 35-44, 45-54, 55-64, 65+ |
| `genders` | `1 → MALE`, `2 → FEMALE` |
| `includeBaseAudiences` | Include custom audiences prefixed `Base_` |
| `filmGenres` | Match custom audiences prefixed `GENEROS_CINEMATOGRAFICOS_` |

**Supported countries**: US, CL, AR, MX, ES, BR, CO, PE, GB, FR, DE, IT, CA, AU, JP, KR

### Insights

**Endpoint**: `GET /api/google/campaigns/[id]/insights`

**Caching**: Same strategy as Meta (1hr active, 24hr completed)

**Metrics collected**: impressions, clicks, ctr, averageCpc, conversions, cost, videoViews, videoViewRate, averageCpv

Uses GAQL (Google Ads Query Language) via `searchStream` for data retrieval.

### Google API Routes

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/google/campaigns/create-and-sync` | Create campaign + ads + auto-sync |
| GET | `/api/google/campaigns/[id]` | Get campaign details |
| POST | `/api/google/campaigns/[id]/sync` | Manual sync to Google |
| GET | `/api/google/campaigns/[id]/insights` | Fetch metrics (cached) |
| POST | `/api/google/ads` | Create ad |

---

## Asset Management

### Upload Flow

```
User uploads file
    │
    ▼
POST /api/upload/image  or  POST /api/upload/video
    │
    ├── Store in GCS (Google Cloud Storage)
    ├── Create DB record (status: PENDING)
    │
    ▼
Background validation (async)
    │
    ├── Validate dimensions & aspect ratio
    ├── Validate duration (video only)
    ├── Check platform eligibility:
    │   ├── facebookEligible
    │   ├── instagramEligible
    │   └── youtubeEligible
    │
    ▼
Publish SSE events
    ├── image_validated / video_validated
    ├── image_eligibility_checked / video_eligibility_checked
    └── image_ready / video_ready (or video_error)
```

### Upload Endpoints

**Image**: `POST /api/upload/image`
- Multipart form-data with `file` field
- Query params: `filmMuviUuid` (required), `name` (optional, max 255)
- Max size: 20MB
- Formats: JPEG, PNG, WebP
- Returns: `{ id, filmMuviUuid, name, storageKey, url, mimeType, size }`

**Video**: `POST /api/upload/video`
- Multipart form-data with `file` field
- Query params: `filmMuviUuid` (required), `name` (optional, max 255)
- Max size: 1000MB
- Formats: MP4, MOV, WebM
- Returns: `{ id, filmMuviUuid, name, storageKey, url, mimeType, size }`

### GCS Storage

| Detail | Value |
|--------|-------|
| Service | Google Cloud Storage |
| Auth | Service account (JSON key) |
| Cache control | max-age: 1 year |
| Public URLs | Optional CDN base URL via `GCS_PUBLIC_URL_BASE` |

### Asset Readiness for Sync

Before syncing a campaign to a platform, assets must be ready:

| Platform | Image readiness | Video readiness |
|----------|----------------|-----------------|
| Meta | Direct URL (no upload needed) | `metaVideoId` must be set (uploaded to Meta) |
| Google | At least one image per ad exists | `youtubeVideoId` must be set (uploaded to YouTube) |

If assets aren't ready at campaign creation time, the campaign is marked `PENDING_ASSETS` and the cron job handles deferred sync.

---

## Triggers

Every trigger lives in the `functions/` codebase (Firebase Cloud Functions v2)
and dispatches to the App Hosting backend over HTTP, authorized by an OIDC token
minted for the function's service account. See `functions/src/index.ts`.

### Sync Campaign (queue — the main path)

| Detail | Value |
|--------|-------|
| Endpoint | `POST /api/internal/sync-campaign` |
| Auth | OIDC token, audience `INTERNAL_TRIGGER_AUDIENCE` |
| Trigger | `syncCampaign` task queue (`onTaskDispatched`) |
| Enqueued by | `onAdAssetsReady`, a Firestore trigger on `ads/{adId}` |
| Retries | 5 attempts, 30s minimum backoff |
| Source | `src/app/api/internal/sync-campaign/route.ts` |

**Purpose**: complete the platform sync for a single campaign the moment its
assets land. The readiness condition is written by our own asset pipeline, so
there is nothing to poll for — the Firestore write *is* the signal. Only the
empty → non-empty transition on `imageIds` enqueues, so editing an already
populated ad does not re-dispatch.

### Sweep Pending Campaigns (safety net)

| Detail | Value |
|--------|-------|
| Endpoint | `GET /api/cron/sync-pending-campaigns` |
| Auth | OIDC token, audience `INTERNAL_TRIGGER_AUDIENCE` |
| Trigger | `sweepPendingCampaigns` (`onSchedule`, hourly) |
| Source | `src/app/api/cron/sync-pending-campaigns/route.ts` |

**Purpose**: catch campaigns whose enqueue never happened or exhausted its
retries. Both paths run the same `syncPendingCampaign` from
`src/lib/campaigns/pending.ts`, so they cannot drift apart. Under normal
operation this sweep finds nothing to do.

**Flow**:
1. Fetch all campaigns with `PENDING_ASSETS` status
2. For each campaign, check which platforms are selected (META, GOOGLE)
3. Check asset readiness:
   - **Meta**: never gated — `syncCampaignToMeta()` uploads the videos itself
   - **Google**: at least one image must exist on an ad
4. If ready → call `syncCampaignToMeta()` and/or `syncCampaignToGoogle()`,
   skipping any platform that already carries a campaign id
5. If not ready → count as still pending and move on

**Response**:
```json
{
  "processed": 5,
  "synced": 3,
  "stillPending": 1,
  "errors": [
    { "campaignId": "abc123", "error": "Meta: Rate limit exceeded" }
  ]
}
```

### Sync Ad Approvals

| Detail | Value |
|--------|-------|
| Endpoint | `GET /api/cron/sync-ad-approvals` |
| Auth | OIDC token, audience `INTERNAL_TRIGGER_AUDIENCE` |
| Trigger | `syncAdApprovals` (`onSchedule`, every 15 minutes) |
| Source | `src/app/api/cron/sync-ad-approvals/route.ts` |

**Purpose**: poll Meta and Google for approval transitions and recompute
`Campaign.approvalSummary`. Unlike the campaign sync above this genuinely has to
poll — neither platform exposes a webhook for approval changes in third-party ad
accounts (see `docs/limitations.md`).

`REFRESH_INTERVAL_MINUTES` in the route is the staleness threshold for picking
ads and must match the schedule, or each ad refreshes at roughly half the
advertised rate.

---

## Real-Time Events (Firestore)

### Overview

The system uses **Firestore realtime listeners** to push updates to the UI during campaign creation, asset validation, and sync operations. This replaced a self-hosted Mercure SSE hub, removing a dedicated GCE VM and its JWT secret.

| Detail | Value |
|--------|-------|
| Service | Cloud Firestore (same GCP project) |
| Server | `publish()` in `src/lib/events/firestore.ts` (Admin SDK) |
| Client | `useFilmEvents()` in `src/hooks/useFilmEvents.ts` (`onSnapshot`) |
| Auth | Firebase Auth ID token + security rules in `firestore.rules` |
| Retention | TTL policy on `expiresAt`, 1 hour |
| Semantics | Fire-and-forget (never throws, logs warnings) |

### Document Structure

```
filmEvents/{filmMuviUuid}                 <- { allowedPartnerIds: [...] }
filmEvents/{filmMuviUuid}/events/{autoId} <- the event payload
```

All events for a film's assets and campaigns land in the same subcollection. The
parent document carries the subscription ACL: film ownership lives in the
external Pijama API, which security rules cannot reach, so
`grantFilmEventAccess()` records the authorized partner from the server
components that already ran the access check.

Listeners only receive events created after they mount (`where('createdAt', '>', mountedAt)`),
so a page load never replays the backlog still inside the TTL window.

### Event Types

| Event | When | Payload |
|-------|------|---------|
| `connected` | Client connects to SSE | - |
| `heartbeat` | Periodic keep-alive | - |
| `video_ready` | Video uploaded to Meta | `{ videoId, metaVideoId }` |
| `video_error` | Video upload failed | `{ videoId, error }` |
| `image_ready` | Image processed | `{ imageId }` |
| `image_validated` | Image validation complete | `{ imageId, status, errors[], aspectRatio }` |
| `video_validated` | Video validation complete | `{ videoId, status, errors[] }` |
| `image_eligibility_checked` | Platform eligibility checked | `{ imageId, facebookEligible, instagramEligible }` |
| `video_eligibility_checked` | Platform eligibility checked | `{ videoId, facebookEligible, instagramEligible, youtubeEligible }` |
| `youtube_video_ready` | Video uploaded to YouTube | `{ videoId, youtubeVideoId }` |
| `youtube_video_error` | YouTube upload failed | `{ videoId, error }` |
| `campaign_progress` | During sync | `{ campaignId, step, progress (0-100), message }` |
| `campaign_complete` | Sync finished | `{ campaignId }` |
| `campaign_error` | Sync failed | `{ campaignId, error }` |

### Campaign Sync Progress Steps

| Step | Progress | Platform |
|------|----------|----------|
| `media` | 30% | Meta |
| `meta_campaign` | 40% | Meta |
| `meta_adsets` | 60% | Meta |
| `image_ad` | 70% | Meta |
| `video_ad` | 85% | Meta |
| `syncing` | 95% | Meta |
| `google_campaign` | 40% | Google |
| `google_adgroup` | 60% | Google |
| `image_upload` | 70% | Google |
| `image_ad` | 80% | Google |
| `enabling` | 90% | Google |
| `complete` | 100% | Both |

---

## Billing Integration (Stripe)

### Prepaid Account Model

Each partner has an **Account** with a prepaid balance. Producers deposit funds first, then those funds are charged when campaigns are created.

```
Deposit (Stripe Checkout)
    │
    ▼
Account Balance += deposit amount
    │
    ▼
Campaign Charge
    │
    ▼
Account Balance -= campaign budget
```

### Checkout Flow

**Endpoint**: `POST /api/account/checkout`

**Request**: `{ amount: number (min $5), returnUrl?: string }`

**Process**:
1. Calculate worst-case Stripe fee via `calculateWorstCaseFee(amount)`
2. Calculate total charge: `amount + fee`
3. Resolve Stripe customer (validate existing or create new)
4. Create Stripe Checkout Session (mode: 'payment', currency: 'usd')
5. Create pending deposit transaction in database
6. Return `{ sessionId, url }` — redirect user to Stripe

**Redirect URLs**:
- Success: `{origin}{returnUrl}/account?payment=success&session_id={id}`
- Cancel: `{origin}{returnUrl}/account?payment=cancelled&session_id={id}`

### Stripe Webhook

**Endpoint**: `POST /api/webhooks/stripe`

**Event**: `checkout.session.completed`

**Process**:
1. Verify webhook signature with `STRIPE_WEBHOOK_SECRET`
2. Record deposit with actual Stripe fee
3. Perform fee reconciliation — credit back difference between estimated and actual fees
4. Update account balance and transaction history

### Campaign Charge

**Endpoint**: `GET /api/account/charge`

**Request**: `{ campaignId, amount, campaignName }`

Deducts campaign budget from partner's account balance and creates a `CAMPAIGN_CHARGE` transaction record.

### Transaction Types

| Type | Description |
|------|-------------|
| `DEPOSIT` | Funds added via Stripe checkout |
| `CAMPAIGN_CHARGE` | Budget deducted for campaign |
| `REFUND` | Funds returned |
| `ADJUSTMENT` | Manual balance adjustment (fee reconciliation) |

### Env Vars

| Variable | Purpose |
|----------|---------|
| `STRIPE_SECRET_KEY` | Server-side API key |
| `STRIPE_WEBHOOK_SECRET` | Webhook signature verification |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | Client-side key (checkout redirect) |

---

## AI Copy Generation (Gemini)

### Overview

**Endpoint**: `POST /api/copies/generate`

Uses **Google Gemini** (model: `gemini-2.0-flash-001`) via Vertex AI to generate ad copy variants for campaigns.

| Detail | Value |
|--------|-------|
| Model | gemini-2.0-flash-001 |
| Endpoint | Vertex AI (`us-central1-aiplatform.googleapis.com`) |
| Auth | GCS service account (shared credentials) |

### Request

```json
{
  "filmId": "abc123",
  "languages": ["es", "en", "pt"]
}
```

Languages default to all three (Spanish, English, Portuguese) if not specified.

### Process

1. Check database cache — if all requested languages cached, return `{ cached: true }`
2. Fetch film data from Muvi API (genres, director, duration)
3. Generate ad copy variants per language via Gemini
4. Save generated copies to database for future cache hits

### Response

```json
{
  "copies": {
    "es": [
      {
        "headline": "...",
        "primaryText": "...",
        "description": "...",
        "callToAction": "...",
        "variant": "A"
      }
    ],
    "en": [...],
    "pt": [...]
  },
  "cached": false
}
```

---

## Budget Validation

### Minimum Budget Rules

| Platform | Minimum Daily | Rule |
|----------|---------------|------|
| Meta | $1/day per AdSet | `languages x 2 (image + video AdSets) x $1` |
| Google | $5/day flat | Fixed minimum regardless of targeting |

### Calculation

```
Daily minimum = Meta daily (if selected) + Google daily (if selected)
Lifetime minimum = Daily minimum x scheduled days
```

**Example**: 2 languages, both platforms, 30-day campaign
- Meta: 2 languages x 2 AdSets x $1 = $4/day
- Google: $5/day
- Daily total: $9/day
- Lifetime minimum: $9 x 30 = $270

### Validation Response

```json
{
  "valid": true,
  "minimumBudget": 270,
  "dailyMinimum": 9,
  "scheduledDays": 30,
  "errorMessage": null,
  "helperMessage": "Presupuesto minimo: $270 para 30 dias"
}
```

Source: `src/lib/campaigns/budget-validation.ts`

---

## API Routes Reference

### Campaign Management

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/campaigns/draft` | Save campaign draft |
| GET | `/api/campaigns/drafts` | List drafts |
| GET/POST | `/api/campaigns/[id]` | Get/update campaign |

### Meta Ads

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/meta/campaigns` | Create Meta campaign |
| POST | `/api/meta/campaigns/create-and-sync` | Create + auto-sync to Meta |
| GET | `/api/meta/campaigns/[id]` | Get campaign |
| POST | `/api/meta/campaigns/[id]` | Update campaign |
| POST | `/api/meta/campaigns/[id]/sync` | Manual sync |
| GET | `/api/meta/campaigns/[id]/insights` | Fetch metrics |
| POST | `/api/meta/ads/[id]` | Update ad |
| GET | `/api/meta/ads/[id]/preview` | Ad preview |
| GET | `/api/meta/audiences` | List saved audiences |
| GET | `/api/meta/locations` | Location data |

### Google Ads

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/google/campaigns/create-and-sync` | Create + auto-sync |
| GET | `/api/google/campaigns/[id]` | Get campaign |
| POST | `/api/google/campaigns/[id]/sync` | Manual sync |
| GET | `/api/google/campaigns/[id]/insights` | Fetch metrics |
| POST | `/api/google/ads` | Create ad |

### Asset Upload

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/upload/image` | Upload image to GCS |
| POST | `/api/upload/video` | Upload video to GCS |
| POST | `/api/films/[filmId]/images` | Create film image record |
| GET | `/api/films/[filmId]/images` | List film images |
| POST | `/api/films/[filmId]/videos` | Create film video record |
| GET | `/api/films/[filmId]/videos` | List film videos |
| POST | `/api/assets/[id]/revalidate` | Revalidate asset |
| POST | `/api/assets/crop` | Crop/transform image |

### Billing

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/account/balance` | Get account balance |
| POST | `/api/account/checkout` | Create Stripe checkout session |
| GET | `/api/account/charge` | Charge campaign budget |
| POST | `/api/webhooks/stripe` | Stripe payment webhook |

### AI & Content

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/copies/generate` | Generate ad copy via Gemini |

### Internal triggers

Dispatched from `functions/`, authorized by OIDC. Not reachable from the UI.

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/internal/sync-campaign` | Sync one campaign whose assets are ready |
| GET | `/api/cron/sync-pending-campaigns` | Hourly sweep of pending campaigns |
| GET | `/api/cron/sync-ad-approvals` | Poll Meta/Google for approval changes |

### Auth

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/login` | User login |
| POST | `/api/auth/logout` | User logout |
| GET | `/api/auth/session` | Get current session |

---

## Data Model

```
Partner (1)
  │
  ├── Account (1) ──► AccountTransaction (many)
  │
  └── Campaign (many)
        │
        ├── platforms: [META, GOOGLE]
        ├── budget, budgetType (DAILY/LIFETIME)
        ├── startDate, endDate
        ├── targeting (countries, age, gender, genres, LGBT)
        ├── objective (CONVERSIONS / LANDING_PAGE_VIEW)
        ├── language (ISO 639-1)
        │
        ├── Meta IDs: metaCampaignId, imageAdSetId, videoAdSetId
        ├── Google IDs: googleCampaignId, googleAdGroupId
        │
        └── Ad (1-5 per campaign)
              ├── headlines[], bodies[], descriptions[]
              ├── callToAction, linkUrl
              ├── adSetType: IMAGE or VIDEO
              │
              ├── Image (many)
              │     ├── storageKey, url
              │     ├── facebookEligible, instagramEligible
              │     └── status (PENDING → READY / INVALID)
              │
              └── Video (many)
                    ├── storageKey, url
                    ├── metaVideoId, youtubeVideoId
                    ├── facebookEligible, instagramEligible, youtubeEligible
                    └── status (PENDING → READY / INVALID)
```

See `docs/firestore-migration.md` for the complete Firestore layout.
