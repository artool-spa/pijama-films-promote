# Asset Feed Spec Options

You can use the following options in your `asset_feed_spec`. See Ad Asset Feed Spec for more reference information.

## Asset Feed Spec Options

### images
- **Type**: array of list
- **Required for**: `SINGLE_IMAGE` and `CAROUSEL_IMAGE` format
- **Description**: Array of eligible images. Images provided in this array should be included in the ad account's image library.
- **Format**: Provide this field as an array of list containing. Either `url` or `hash` is required.
```
  {"url": "{IMAGE_URL}", "hash": "{IMAGE_HASH}", "url_tags": "{TAG}"}
```

### videos
- **Type**: array of list
- **Required for**: `SINGLE_VIDEO` format
- **Description**: Array of `video_ids`. The `video_ids` provided in this array should belong to the ad account.
- **Format**: Provide this field as an array of list containing:
```
  {"video_id": "{VIDEO_ID}", "thumbnail_url": "{THUMBNAIL_URL}", "url_tags": "{TAG}"}
```

### carousels
- **Type**: array of list
- **Status**: Optional
- **Description**: An array of `child_attachments` along with the `multi_share_end_card` and `multi_share_optimized` Booleans, and `adlabels`. The `child_attachments` provided in this array should belong to the ad account.
- **Format**: Provide the `child_attachments` as an array of list containing:
```
  {"image_label": {"name": "{IMAGE_LABEL}"}, "video_label": {"name": "{VIDEO_LABEL}"}, "title_label": {"name": "{TITLE_LABEL}"}, "description_label": {"name": "{DESC_LABEL}"}, "link_url_label": {"name": "{LINK_URL}"}}
```
- **Note**: Either `image_label` or `video_label` is required.
- See Field Specifications for more information.

### bodies
- **Type**: array of list
- **Status**: Optional
- **Description**: Array of bodies. The primary message or copy of the ad.
- **Format**: Provide this field as an array of list of:
```
  {"text": "{BODY_TEXT}", "url_tags": "{TAG}"}
```

### call_to_action_types
- **Type**: array of list
- **Required for**: All objectives, except `OUTCOME_AWARENESS`
- **Description**: Array of call-to-action-type values.
- **Format**: Provide this field as an array of list of:
```
  {"{CALL_TO_ACTION}"}
```
- **Note**: You can provide multiple values, up to five.

### titles
- **Type**: array of list
- **Status**: Optional
- **Description**: Array of titles. A title is a short headline in the ad, generally shown next to a link, image or video.
- **Format**: Provide this field as an array of list of:
```
  {"text": "{TITLE}", "url_tags": "{TAG}"}
```

### descriptions
- **Type**: array of list
- **Status**: Optional
- **Description**: Array of secondary description text, displayed less prominently than bodies or titles. Generally appears near the bottom of the ad.
- **Format**: Provide this field as an array of list of:
```
  {"text": "{DESCRIPTION}", "url_tags": "{TAG}"}
```

### link_urls
- **Type**: array of list
- **Required**: Yes
- **Description**: Array of link URLs.
- **Format**: Provide this field as an array of list of:
```
  {"website_url": "{URL}"}
```

### ad_formats
- **Type**: array of strings
- **Required**: Yes
- **Description**: Array of Facebook ad formats we should create the ads in. Supported formats are: `SINGLE_IMAGE`, `CAROUSEL`, `SINGLE_VIDEO`, `AUTOMATIC_FORMAT`.
- **Format**: Provide this field as an array of strings:
```
  ["{AD_FORMAT}"]
```

### optimization_type
- **Type**: string
- **Status**: Optional
- **Description**: Optimization type used in asset feed. Possible values are `ASSET_CUSTOMIZATION`, `LANGUAGE`, `PLACEMENT`, and `REGULAR`.

### message_extensions
- **Type**: array of strings
- **Status**: Optional
- **Description**: Message extension type used in asset feed.
- **Possible values**: `whatsapp`

### onsite_destinations
- **Type**: array of list
- **Valid for**: Static Ads; `SINGLE_IMAGE`, `SINGLE_VIDEO`, or `CAROUSEL` format
- **Required for**: Shops Ads
- **Description**: Provide this field as an array of list containing one of the following:
```
  "storefront_shop_id": "<SHOP_STOREFRONT_ID>"
  "shop_collection_product_set_id": "<PRODUCT_SET_ID>"
  "details_page_product_id": "<PRODUCT_ID>"
```

### shops_bundle
- **Type**: boolean
- **Valid for**: Advantage+ Catalog Ads
- **Required for**: Shops Ads
- **Description**: Provide this field for shop optimization. Includes both `reasons_to_shop` and `automated_product_tags`.
- **Values**: `true` or `false`

### reasons_to_shop
- **Type**: boolean
- **Valid for**: Advantage+ Catalog Ads
- **Required for**: Shops Ads
- **Description**: Provide this field for shop optimization. Automatically highlights reasons to shop.
- **Values**: `true` or `false`

## Asset Feed Spec Restrictions

### Ad Formats
- Supported `ad_formats`: `SINGLE_IMAGE`, `CAROUSEL`, `SINGLE_VIDEO`, and `AUTOMATIC_FORMAT`.
- Only one `ad_format` is allowed per asset feed.
- Each `ad_format` counts as one asset in an asset feed.

### Number of Assets
- Maximum of 30 total assets. For example, you have 28 assets with 10 images, 5 bodies, 5 titles, 5 descriptions, 1 ad_format, 1 link_url, and 1 call_to_action_types.
- Total number of images: ≤ 10
- Total number of videos: ≤ 10 (If you use Instagram as your placement, only square videos or landscape videos are supported)
- Total number of bodies: ≤ 5
- Total number of call-to-actions: ≤ 5
- Total number of titles: ≤ 5
- Total number of links: ≤ 5
- Total number of descriptions: ≤ 5

### Image Requirements
- Recommended image specs: 1.9:1
- Recommended image size: 1,200 x 628 pixels
- For `CAROUSEL_IMAGE` format, you must provide at least 2 images
- If you use Instagram as your placement, use square images for better performance

### Text Requirements
- Title and description text: maximum length of 255 characters
- Body text: maximum length of 1024 characters
- If you do not specify any description, we scrape the link you provided to retrieve a description
- For `CAROUSEL_IMAGE`, titles are optional

### URL Tags
`url_tags` are optional and only available for images, videos, bodies, descriptions, and titles. Facebook appends `url_tags` to the link URL as parameters for each asset in the ad.

### Valid Asset Feed Combination for SINGLE_IMAGE Format
- images
- bodies
- titles
- descriptions
- 1 `SINGLE_IMAGE` format
- link_urls

Example:
```
"link_urls=[{'website_url':'<WEBSITE_URL>'}, {'website_url':'<WEBSITE_URL>'}]"
```

## Use Deep Links

You can use deeplinks in asset feed specs for campaigns with the following objectives:
- `APP_INSTALLS`
- `CONVERSIONS`
- `LINK_CLICKS`

Add `deeplink_url` in `link_urls` when you create your `asset_feed_spec`.

### Example cURL Request
```bash
curl \\ -F 'object_story_spec={"page_id": "<PAGE_ID>" "instagram_user_id" : "<IG_USER_ID>", }' \\
  -F 'asset_feed_spec={
    "images": [{"hash":"<IMAGE_HASH>"}],
    "bodies": [{"text":"<BODY_1>"}, {"text":"<BODY_2>"}],
    "titles": [{"text":"<TITLE_1>"}, {"text":"<TITLE_2>"}],
    "descriptions": [{"text":"<DESCRIPTION>"}],
    "ad_formats": ["SINGLE_IMAGE"],
    "link_urls": [{"website_url":"<APP_OBJECT_STORE_URL>", "deeplink_url":"<DEEPLINK_URL>"}]
  }' \\
  -F 'access_token=<ACCESS_TOKEN>' \\
  https://graph.facebook.com/v24.0/act_<AD_ACCOUNT_ID>/adcreatives
```

## Website to WhatsApp Ads

You can create ads that send people to your website with a WhatsApp button appearing at the bottom of the ad.

Add the `message_extensions` parameter with `"type": "whatsapp"` when you create your `asset_feed_spec`.

### Example cURL Request
```bash
curl \\ -F 'object_story_spec={"page_id": "<PAGE_ID>" "instagram_user_id" : "<IG_USER_ID>", }' \\
  -F 'asset_feed_spec={
    "images": [{"hash":"<IMAGE_HASH>"}],
    "bodies": [{"text":"<BODY_1>"}, {"text":"<BODY_2>"}],
    "titles": [{"text":"<TITLE_1>"}, {"text":"<TITLE_2>"}],
    "descriptions": [{"text":"<DESCRIPTION>"}],
    "ad_formats": ["SINGLE_IMAGE"],
    "link_urls": [{"website_url":"<BUSINESS_URL>"}],
    "message_extensions": [{"type": "whatsapp"}]
  }' \\
  -F 'access_token=<ACCESS_TOKEN>' \\
  https://graph.facebook.com/v24.0/act_<AD_ACCOUNT_ID>/adcreatives
```