# Multi-Language Ads

## Overview

Customize different parts of ad creative such as the image, video, text, and body of an ad to reach speakers of different languages. Facebook optimizes your ad to show the right language version to the right people.

This helps you to easily set up an ad in multiple languages and deliver the most relevant language version in your ad to a viewer while retaining a broad targeting for the ad. This enables you to have personalized content based on a viewer's spoken language while maintaining cost-efficient ads.

Multi-Language Ads is one of our three APIs that use asset customization rules.

## Get Started

Before you get started, check restrictions for this product. If your use case meets our specifications, move on to the following steps:

1. **Step 1**: Create an ad campaign and ad set
2. **Step 2**: Provide creative via `asset_feed_spec` — see also Available Languages
3. **Step 3**: Create an ad with `asset_feed_spec` in `creative_spec`
4. **Optional Step 4**: Preview your ad

If you do not have the resources to manually translate your ad, check out our automatic translation service.

## Step 2: Provide Creative via asset_feed_spec

Multi-Language Ads creatives are specified using `asset_feed_spec`s. An asset feed is a collection of different creative elements, such as image, titles, bodies, and so on. You create an `asset_feed_spec` at `/adcreative`.

To create an `asset_feed_spec`, provide an array of assets for each different language. Add a label to tag each asset to identify the language the asset belongs to. Facebook uses the labels in `asset_customization_rules` to group assets together by language. You should provide **at least one asset per asset type**.

### Available Parameters

Parameters to provide in `asset_feed_spec` include:

#### Images
- **Type**: array
- **Required for**: `SINGLE_IMAGE` ad format
- **Description**: Provide `url` or `hash`. Images as `url` or `hash`. You should provide images which are in the ad account's image library.
- **Format**: Array of `{"url": "<IMAGE_URL>", "hash": "<IMAGE_HASH>", "url_tags": "<TAG>", "adlabels": [{"name": "<LABEL>"}]}`

#### Videos
- **Type**: array
- **Required for**: `SINGLE_VIDEO` ad format
- **Description**: Array of `video_ids`. Videos should be in the ad account's video library.
- **Format**: Array of `{"video_id": "<VIDEO_ID>", "thumbnail_url": "{<THUMBNAIL_URL>}", "url_tags": "{<TAG>}", "adlabels": [{"name": "<LABEL>"}]}`

#### Bodies
- **Type**: array
- **Required**: Yes, but `url_tags` are optional
- **Description**: Array of bodies containing primary message of ad.
- **Format**: Array of `{"text": "<BODY_TEXT>", "url_tags": "<TAG>", "adlabels": [{"name": "<LABEL>"}]}`

#### Titles
- **Type**: array
- **Required**: Yes, but `url_tags` are optional
- **Description**: Array of titles. A short headline in the ad, generally shown next to a link, image or video.
- **Format**: Array of `{"text": "<TITLE>", "url_tags": "<TAG>", "adlabels": [{"name": "<LABEL>"}]}`

#### Descriptions
- **Type**: array
- **Required**: Yes, but `url_tags` are optional
- **Description**: Array of secondary description text, displayed less prominently than bodies or titles.
- **Format**: Array of `{"text": "<DESCRIPTION>", "url_tags": "<TAG>", "adlabels": [{"name": "<LABEL>"}]}`

#### Link URLs
- **Type**: array
- **Required**: Yes, but `display_url` and `deeplink_url` are optional
- **Description**: Array of link URLs.
- **Format**: Array of `{"website_url": "<URL>", "adlabels": [{"name": "<LABEL>"}], "deeplink_url": "<DEEPLINK>", "display_url": "<DISPLAY_URL>"}`

#### Call-to-Action Types
- **Type**: array
- **Required**: Yes
- **Description**: Array of call-to-action-type values.
- **Format**: Array of supported call to actions: `["<CALL_TO_ACTION>"]`

#### Ad Formats
- **Type**: array
- **Required**: Yes
- **Description**: Array of Facebook ad formats you want to create the ads in. Supported formats are: `SINGLE_IMAGE`, `SINGLE_VIDEO`.
- **Format**: Array of `["{<AD_FORMAT>}"]`

#### Asset Customization Rules
- **Type**: See table below under Asset Customization Rules
- **Required**: Yes
- **Description**: Array of asset customization rules.

## Asset Customization Rules

Define the assets that appear together for viewers who speak a particular language. Each rule has a `customization_spec`.

Provide exactly one default rule. This rule must include the assets that Facebook displays if someone's preferred language isn't found.

### Asset Customization Rules Parameters

| Property Name | Type | Description |
|---|---|---|
| customization_spec | `{"locales": [<LOCALE1>, <LOCALE2>]}` | Required. Define the locales where the assets in this rule should deliver. For supported locales, see Available Languages. |
| image_label | `{"name": "<LABEL>"}` | Required for `SINGLE_IMAGE` ad format. Label attached to one of the image assets in the asset feed. |
| video_label | `{"name": "<LABEL>"}` | Required for `SINGLE_VIDEO` ad format. Label attached to one of the video assets in the asset feed. |
| body_label | `{"name": "<LABEL>"}` | Required. Label attached to one of the body assets in the asset feed. |
| title_label | `{"name": "<LABEL>"}` | Required. Label attached to one of the title assets in the asset feed. |
| description_label | `{"name": "<LABEL>"}` | Required. Label attached to one of the description assets in the asset feed. |
| link_url_label | `{"name": "<LABEL>"}` | Required. Label attached to one of the `link_url` assets in the asset feed. |
| is_default | boolean | Required. Boolean flag to identify the default rule. You should set exactly one rule with `is_default` flag as `true`. |

## Available Languages

The locales you provide in `customization_spec` must be locale IDs supported in ads targeting. See Targeting and Placement, Locales. You can search for supported locales using the `/search` endpoint.

Example request:
```
curl "https://graph.facebook.com/v24.0/search?type=adlocale&q=en&limit=2&access_token=<ACCESS_TOKEN>"
```

On success you get a list of languages with keys to use in your asset customization rules. See Targeting Search for more details.

## Step 3: Create Ads using Asset Feed Specs

You can create an asset feed using the `asset_feed_spec` field in `POST ad_account_ID/adcreatives`.

Example request:
```
curl -X POST "https://graph.facebook.com/v24.0/act_<AD_ACCOUNT_ID>/adcreatives" \\
  -d 'object_story_spec={"page_id": "<PAGE_ID>", "instagram_user_id": "<IG_USER_ID>", ...}' \\
  -d 'asset_feed_spec={"ad_formats": ["SINGLE_IMAGE"], "bodies": [...], ...}' \\
  -d 'access_token=<ACCESS_TOKEN>'
```

On success, you get the ID for the ad creative: `{"id": "238474593777777"}`

If your `asset_feed_spec` does not meet the restrictions, you see an error.

To create an ad with this ad creative ID, call `POST act_AD_ACCOUNT_ID/ads`. Alternatively, to display different languages in your campaign, use the `asset_feed_spec` in `object_story_spec` and `creative_spec`.

To verify the new `asset_feed_spec`, you call `GET` on the ad ID or the ad creative ID:
```
curl -G "https://graph.facebook.com/v24.0/<CREATIVE_ID>" \\
  -d 'fields=object_story_spec,asset_feed_spec' \\
  -d 'access_token=<ACCESS_TOKEN>'
```

## Optional Step 4: Preview Your Ad

Preview the different language versions of your ad using the `generatepreview` endpoint. Add a `dynamic_asset_label` field with an `adlabel` in a request.

For example, to preview the French version of the above creative:
```
curl -X POST "https://graph.facebook.com/v24.0/act_<AD_ACCOUNT_ID>/generatepreviews" \\
  --data-urlencode 'creative={"object_story_spec": {"page_id": "<PAGE_ID>"}, "asset_feed_spec": {...}}' \\
  -d 'ad_format=DESKTOP_FEED_STANDARD' \\
  -d 'dynamic_asset_label=french' \\
  -d 'access_token=<ACCESS_TOKEN>'
```

## Automatic Translations

You can use our automatic translation service if you do not have the resources to manually translate your ad copy.

The source for the automatic translation can be found in the text assets specified by the default asset customization rule.

To create an automatically translated version of your ad copy, add `autotranslate` to `asset_feed_spec`. Then, specify the languages in this list.

Example:
```
curl -X POST "https://graph.facebook.com/v24.0/act_<AD_ACCOUNT_ID>/adcreatives" \\
  -d 'object_story_spec={"page_id": "<PAGE_ID>", "instagram_user_id": "<IG_USER_ID>", ...}' \\
  -d 'asset_feed_spec={"ad_formats": ["SINGLE_IMAGE"], "autotranslate": ["fr_XX"], ...}' \\
  -d 'access_token=<ACCESS_TOKEN>'
```

The automatically translated copies can be reviewed with a call to the `asset_feed_spec` field on the creative.

Any edits to the auto translated copies on the spec will be dropped if the same language is specified in `autotranslate`.

### Custom Link URLs with Automatic Translations

You can add a custom link URL to the automatically translated ad version.

To do this, add an URL to the `link_urls` field along with an `adlabel` and add a new rule into `asset_customization_rules` with the associated locale and `link_url_label`.

## Restrictions

The following are restrictions and limits on your asset feed.

### Ad Formats
- Only one ad format per `asset_feed_spec`
- For `SINGLE_IMAGE` format, you must provide at least one image
- For `SINGLE_VIDEO` format, you must provide at least one video

### Assets, General
- You can provide at most 49 assets for every asset type except `call_to_action_types`
- You must provide exactly one asset for all objectives: `call_to_action_type`

### Text Assets
- You must provide at least one text asset, such as titles, bodies, descriptions and link_urls, for every language version in the feed
- All text assets should have the `adlabels` field
- Maximum length: 255 characters for title, 4096 characters for body, and 10000 characters for description

### Image and Video Assets
- For recommended image sizes by placement and objective, see the Ads Guide
- You can use up to one image or video asset without an `adlabel`. We use this image or video for all the languages not specifically called out
- If you provide additional videos or images, you must include `adlabel`s and provide these labels in your asset customization rules

### Link URL Assets
- If you provide `url_tags`, we append them to the `link_url` as parameters for each asset in the ad
- If you use the `APP_INSTALLS` objective, your `link_url` should be the same as the ad set's `promoted_object.object_store_url`

### Asset Customization Rules
- You should provide an asset customization rule for every language variant in `asset_feed_spec`
- You should provide one default rule. This is an asset customization rule with `is_default` set to `true`. This acts as a backup rule in the feed

## Placements

Multi-Language Ads supports all placements.

## Available Objectives and Destination Types

- **LINK_CLICKS**: Website and apps, no Messenger
- **APP_INSTALLS**: Desktop or mobile apps
- **CONVERSIONS**: Website and apps, no Messenger
- **REACH**: All destination types
- **BRAND_AWARENESS**: All destination types
- **VIDEO_VIEWS**: All destination types

## Supported Buying Types

- **REACH**: Reach and Frequency
- **AUCTION**

## Supported Translation Directions

The following translation directions are supported. Use the corresponding dialect code in the `autotranslate` field.

| Source Language | Target Language | Dialect Code |
|---|---|---|
| English | Spanish | es_XX |
| English | French | fr_XX |
| English | German | de_DE |
| English | Portuguese | pt_XX |
| English | Italian | it_IT |
| English | Arabic | ar_AR |
| English | Dutch | nl_XX |
| English | Malay | ms_MY |
| English | Swedish | sv_SE |
| English | Indonesian | id_ID |
| English | Polish | pl_PL |
| English | Hindi | hi_IN |
| English | Danish | da_DK |
| English | Turkish | tr_TR |
| English | Tagalog | tl_XX |
| English | Romanian | ro_RO |
| German | English | en_XX |
| Arabic | English | en_XX |
| Hebrew | English | en_XX |
| Spanish | English | en_XX |
| Japanese | English | en_XX |
| Norwegian | English | en_XX |
| French | English | en_XX |
| Dutch | English | en_XX |
| Swedish | English | en_XX |