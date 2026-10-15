# C2 - Console external partner API (read-only)

Consumer: Pijama Promote (`src/lib/atlas/external-api.ts`). Producer: Crazy Cake (Console).
Docs: https://documenter.getpostman.com/view/110727/2sBYHPzhCC. Measured 2026-10-15.

## Transport

- Testing base URL: `https://dashboard-lab.pijamafilms.com` (`ATLAS_SERVER_API_BASE_URL`).
- Auth: `Authorization: Bearer <key>` (`ATLAS_SERVER_API_KEY`, Secret Manager of `pijama-promote-dev`).
- Server-to-server only. **The key is not scoped: it reads all 65 partners.** Isolation between
  producers is therefore entirely on the consumer: `partnerId` comes from the verified session, never
  from a query, body or route param.
- The `partnerId` is the Console `_id` - the same identifier the Atlas SSO session carries (e.g. a
  24-hex ObjectId). The five in-house Firebase users have `partnerId = pijamafilms`, which does NOT
  exist here; they keep the global MUVI catalogue.

## Endpoints

| Call | Success |
|---|---|
| `GET /external/partners` | list of `{partnerId, name, productionCompany?}` |
| `GET /external/partner-movies?partnerId=` | `{status, data: {partner: {partnerId, name, productionCompany?}, movies[]}}` |

Errors: no/invalid token -> 401 `MISSING_API_KEY` / `INVALID_API_KEY`; malformed partnerId -> 400
`INVALID_PARTNER_ID`; unknown partnerId -> 404 `PARTNER_NOT_FOUND`.

Consumer mapping: 401 -> `unauthorized`, 400 -> `invalid_partner`, 404 -> `partner_not_found`
(**empty catalogue, never the global one**), 5xx / redirect / network / timeout -> `unavailable`,
unparseable 200 -> `bad_response`. Missing key or base URL -> `not_configured` (no request, no fallback).

## Movie fields

`_id`, `muviContentUuid`, `originalTitle`, `internationalTitle`, `description`, `genre`, `year`,
`duration` (minutes, integer; may be 0), `language`, `ageRating`, `price` (float), `trailerUrl`,
`directors[]`, `cast[]`, `publishedAt`, `updatedAt`, `assets[]` of `{type, key, url, width, height, duration}`.
Asset types seen: `trailer`, `short`, `poster`, `banner`, `screenshot`.

## Differences from the documentation (measured; the consumer's Zod tolerates all of them)

| Field | Documented | Real |
|---|---|---|
| `genre` | string[] | **string** (also accepted as string[]; comma-split) |
| `assets[].duration` | number | **`"HH:MM:SS"` string or null** (number also accepted) |
| `assets[].key`, `width`, `height` | set | **null in most assets** |
| `trailerUrl` | trailer URL | **always `""`** - the trailer is `assets[type=trailer].url` |
| `language` | language | may be `""` |
| `cast` | names | may be `[]` |
| `partner.productionCompany` | present | may be absent |

Verified: all 65 real partner responses (45 films) captured on 2026-10-15 parse with the schema.

## Invariants the consumer relies on

1. `muviContentUuid` is the film id used by campaigns and every film route.
2. A film may be duplicated in MUVI (one record per rights holder) and some uuids are blocked by
   region at MUVI. The API does not say so; the consumer checks MUVI when a campaign is created.
3. A film duplicated in MUVI (one record per rights holder) appears as separate entries; the consumer does NOT deduplicate.
4. Open question for Crazy Cake: is an `assets[type=short]` promotional material or the film itself?
   Until answered the consumer does NOT map `short` into promotable assets.

## Not covered

Rotation of the key; production (the secret does not exist there, so Atlas sessions in production
get a clear "not configured" error).
