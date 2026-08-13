/**
 * Human labels for the `step` field emitted through the SSE campaign_progress
 * event. Used by the sync progress modal to render clear stage descriptions.
 */

export type ProgressStep =
  | 'media'
  | 'meta_campaign'
  | 'meta_adsets'
  | 'image_ad'
  | 'video_ad'
  | 'google_campaign'
  | 'google_adgroup'
  | 'image_upload'
  | 'video_upload'
  | 'enabling'
  | 'complete'
  | 'syncing';

const LABELS: Record<ProgressStep, { label: string; description: string }> = {
  media: { label: 'Processing media', description: 'Preparing images and videos' },
  meta_campaign: { label: 'Meta campaign', description: 'Creating campaign on Meta' },
  meta_adsets: { label: 'Meta ad sets', description: 'Creating ad sets on Meta' },
  image_ad: { label: 'Image ads', description: 'Creating image ads' },
  video_ad: { label: 'Video ads', description: 'Creating video ads' },
  google_campaign: { label: 'Google campaign', description: 'Creating campaign on Google Ads' },
  google_adgroup: { label: 'Google ad group', description: 'Creating ad group on Google Ads' },
  image_upload: { label: 'Uploading images', description: 'Uploading images to the platform' },
  video_upload: { label: 'Uploading videos', description: 'Uploading videos to the platform' },
  enabling: { label: 'Enabling', description: 'Enabling campaign and ad groups' },
  complete: { label: 'Complete', description: 'Sync finished successfully' },
  syncing: { label: 'Syncing', description: 'Syncing changes with the platform' },
};

export function getStepLabel(step: string): string {
  return LABELS[step as ProgressStep]?.label ?? step;
}

export function getStepDescription(step: string): string {
  return LABELS[step as ProgressStep]?.description ?? '';
}
