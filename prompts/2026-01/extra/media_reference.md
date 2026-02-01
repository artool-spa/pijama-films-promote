# Media Requirements

If you use images or videos that do not meet requirements below, your ad fails validation during ad creative creation.

## Instagram Stream And Explore Ads

### Captions

There is a 2,200 character limit on captions for ads targeting Instagram only. If you try to create an ad that targets Instagram only and exceeds this limit, you will receive an error. If ad targets both Instagram and Facebook and exceeds the limit, the request will succeed, but the ad will not be delivered on Instagram.

### Image and Video Requirements

#### Aspect Ratio

Instagram's recommended aspect ratio for both image and video in Instagram stream is 1:1. Square images and videos utilize the maximum area on mobile devices. Instagram stream also supports images and videos with:

- 1.91:1 aspect ratio
- 4:5 aspect ratio
- Any aspect ratios in between 1.91:1 and 4:5

#### Size

All images and videos must have at least a 600px width, independent of the ad's placement. However, our recommended numbers for images can change by placement:

| Placement | Image Size Recommendation |
|---|---|
| Instagram | 640px width or larger |
| Facebook | 1080px by 1080px or larger |

**Note**: If you run Advantage+ catalog ads, product images specified in product feeds must be at least 600px or more in both width and height.

#### Video Length

Videos need to have between 3 and 60 seconds. A video plays in an endless loop on Instagram but only once on Facebook.

#### Video Thumbnail

`video_data` requires a thumbnail image. That image must have the same aspect ratio as the video, with a width of at least 600px.

#### Video File Size

The video file size cannot be over 2.3GB. After uploaded to Facebook and compressed, it cannot be larger than an internal limit. To see whether video file works as an Instagram ad, upload it first and use this API call to check the `is_instagram_eligible` boolean value:
```bash
curl -G \\
  -d "access_token=<ACCESS_TOKEN>" \\
  -d "fields=is_instagram_eligible" \\
  "https://graph.facebook.com/<API_VERSION>/<VIDEO_ID>"
```

The response looks like this if your video is not eligible:
```json
{
  "is_instagram_eligible": false,
  "id": "<VIDEO_ID>"
}
```

#### Cropping

Videos cannot be cropped, but images can. The following information is only valid for images.

The cropping behavior depends on whether you send a cropping spec. For Facebook placements, you can also use `use_flexible_image_aspect_ratio`.

**If you provide a 100x100 cropping spec in `link_data`:**

- That cropping spec is used for both Instagram and Facebook placements
- If an image is wider than 1.91:1, Instagram crops an ad to 1.91:1

**If you do not provide a cropping spec:**

- If an image is taller than 4:5 without a cropping spec, Instagram crops it to 4:5

#### Cropping And Size

More details about cropping and size recommendations according to your chosen placement.

**For Instagram:**

| Media | With 100x100 Cropping Spec | No 100x100 Cropping Spec |
|---|---|---|
| 1:1 Image | After crop, at least 600x600px | At least 600x600px |
| 4:5 Image | After crop, at least 600x600px | At least 600x750px |
| 1.91:1 Image | After crop, at least 600x600px | At least 600x315px |
| Image ratio between 4:5 and 1.91:1 | After crop, at least 600x600px | At least 600px width |
| Image ratio between 1:1 and 1.91:1 | After crop, at least 600x600px | At least 600px width |
| Image ratio not between 4:5 and 1.91:1 | After crop, at least 600x600px | With `object_story_spec` or `object_story_id`, center crop to 1.91:1 if wider than this, or 4:5 if taller than this. After crop, the width must be at least 600px |

**For Facebook:**

| Media | No cropping spec, and use_flexible_image_aspect_ratio set to false | No cropping spec, and use_flexible_image_aspect_ratio set to true, or not set (Default behavior) | With 100x100 Cropping Spec |
|---|---|---|---|
| 1:1 Image | Center crop of 1.91:1 automatically performed. After crop, at least 600x315px | At least 600x600px | After crop, at least 600x600px |
| 4:5 Image | Center crop of 1.91:1 automatically performed. After crop, at least 600x315px | Center crop of 1:1 automatically performed. After crop, at least 600x600px | After crop, at least 600x600px |
| 1.91:1 Image | At least 600x315px | At least 600x315px | After crop, at least 600x600px |
| Image ratio between 4:5 and 1.91:1 | Center crop of 1.91:1 automatically performed. After crop, at least 600x315px | Center crop of 1:1 automatically performed. After crop, at least 600x600px | After crop, at least 600x600px |
| Image ratio between 1:1 and 1.91:1 | Center crop of 1.91:1 automatically performed. After crop, at least 600x315px | At least 600px width | After crop, at least 600x600px |
| Image ratio not between 4:5 and 1.91:1 | Center crop of 1.91:1 automatically performed. After crop, at least 600x315px | Center crop of 1.91:1 if wider than this or 1:1 if taller than this. After crop, width must be at least 600px | After crop, at least 600x600px |

#### Additional Images

We usually deliver the default image specified by `image_url`, but you can deliver additional images if you set `additional_image_index` in the ad template. You can use `additional_image_index` with `/generatepreviews` or `object_story_id`.

If a product has an image that is too small for Instagram, you do not see any errors when you create the ad, but the image will not serve.

## Instagram Story Ads

### Image and Video Requirements

#### Aspect Ratio

For Instagram Stories, we recommend an aspect ratio for both image and video of 9:16. Instagram Stories are vertical, full-screen ads. We also support:

- 1.91:1 landscape
- 4:5 portrait
- Any aspect ratios in between 1.91:1 and 4:5

For Carousel ads on Instagram Stories, check the Carousel Ads section.

#### Size

The minimum image or video width is 600px.

#### Cropping

Videos cannot be cropped, so you should provide videos between 1.91:1 and 4:5 or 9:16 and taller.

Images can be cropped. You can use image cropping specs for image ads on Instagram Stories using 900x1600 or larger for 9:16 aspect ratio:

- If an image is wider than 1.91:1 and you provide no crop spec, we crop your image to 1.91:1
- If an image ratio is between 4:5 to 9:16 and you do not provide a cropping spec, we crop it to 4:5

## Resources

- **Ads Guide**: Image Stream Ads
- **Ads Guide**: Image Story Ads
- **Ads Guide**: Image Explore Ads
- **Ads Guide**: Video Stream Ads
- **Ads Guide**: Video Story Ads
- **Ads Guide**: Video Explore Ads
- **Best Practices**: Image Sizes