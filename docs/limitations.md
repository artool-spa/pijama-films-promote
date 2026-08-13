# Platform Limitations

This document captures constraints imposed by Meta and Google Ads APIs that
shape how we surface the ad-review lifecycle to producers. If you're wondering
why something is done a specific way in the code, this is where the answer
usually lives.

## 1. Editing ad creatives is not truly "in-place"

### Meta

- Meta `AdCreative` objects are **immutable**. You cannot change
  `headline`, `message`, `image`, `video`, `link_url`, or `call_to_action`
  on an existing creative.
- However, the `Ad` object can point at a **new** `creative_id` via
  `POST /{ad-id}?creative={creative_id: ...}`. This preserves the `metaAdId`
  and triggers a fresh policy review.
- Our current `resyncAdCreativeToMeta` (`src/lib/campaigns/sync.ts`) takes
  the simpler path: it creates a fully new ad in the same ad set via
  `createDynamicCreativeAd` and pauses the previous one. This changes the
  `metaAdId`. A future optimization is to swap the `creative_id` in place.

### Google Ads (Demand Gen)

- Demand Gen image ads are **fully immutable** in Google Ads API v14+. There
  is no "swap creative on existing ad" affordance.
- `resyncAdCreativeToGoogle` therefore creates a new ad in the same ad
  group with `createDemandGenImageAd` and removes the old one via
  `removeAd`. The `googleAdId` changes as a result.
- Responsive Search Ads and Responsive Display Ads do support partial
  `mutate` — if we support those formats in the future, we can edit those in
  place.

### UX consequence

Both platforms reset the ad's approval status to `PENDING_REVIEW` after a
resync. The UI communicates this via the snackbar text "the platform will
review the ad again."

## 2. Approval status cannot be pushed in real time

- Neither Meta nor Google Ads exposes webhooks that fire when an individual
  ad transitions between approval states in third-party ad accounts.
- Our only option is **polling**. `src/app/api/cron/sync-ad-approvals/route.ts`
  polls both platforms on a 15-minute cadence via Cloud Scheduler.
- This means the UI can be up to ~15 minutes stale on approval changes. The
  `RejectionDetailsDialog` exposes a "Refresh from platform" button that
  forces an on-demand fetch when a producer wants to see the current state
  immediately.

## 3. Historical metrics on rejected ads are still returned

- Meta and Google Ads both return metrics for the timeframe **before** an ad
  was disapproved. This can be confusing: the campaign shows impressions and
  clicks even though the ad is no longer being served.
- We do not filter these out. Instead, the `ApprovalWarningBanner` component
  contextualizes the metrics, explaining that they may reflect historical
  delivery rather than current traffic.

## 4. Campaign start date is not editable

- Once a campaign is submitted to Meta or Google Ads, its `start_time` /
  `start_date` cannot be changed. This is a platform constraint.
- The "Edit campaign" form (`/campaigns/[id]/edit`) exposes only `budget`
  and `endDate`. `startDate` is intentionally omitted.

## 5. Operational status vs. approval status

Two orthogonal axes that used to be conflated:

| Axis        | Field(s)                                | Values                          |
|-------------|-----------------------------------------|---------------------------------|
| Operational | `Campaign.status`, `googleEntityStatus` | ACTIVE / PAUSED / …             |
| Approval    | `Ad.approvalStatus`                     | APPROVED / DISAPPROVED / …      |

A campaign can be `ACTIVE` operationally while individual ads inside are
`DISAPPROVED`. The `Campaign.approvalSummary` field rolls up the ads'
approval statuses so lists can render a single indicator without loading all
ads.

The UI now shows **both** chips ("Operational" + "Approval summary") on the
campaign detail page and dual chips on each ad card.

## 6. Google image asset upload cost

`resyncAdCreativeToGoogle` re-uploads every image on the ad via
`uploadImageAsset` because we do not persist Google Ads asset resource
names locally. Google deduplicates by content hash, so this is idempotent —
but it does count against per-day mutation quota. If we scale, we should
persist `googleAssetResourceName` per `Image`.
