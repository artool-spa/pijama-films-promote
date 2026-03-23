export { publish } from './mercure';

import type { AssetStatus } from '@prisma/client';

/**
 * Event types for SSE notifications
 */
export type SSEEventType =
  | 'connected'
  | 'heartbeat'
  | 'video_ready'
  | 'video_error'
  | 'image_ready'
  | 'video_synced'
  | 'asset_sync_complete'
  | 'image_validated'
  | 'video_validated'
  | 'image_eligibility_checked'
  | 'video_eligibility_checked'
  | 'youtube_video_ready'
  | 'youtube_video_error'
  | 'campaign_progress'
  | 'campaign_complete'
  | 'campaign_error';

export interface SSEConnectedEvent {
  type: 'connected';
}

export interface SSEHeartbeatEvent {
  type: 'heartbeat';
}

export interface SSEVideoReadyEvent {
  type: 'video_ready';
  videoId: string;
  metaVideoId: string;
}

export interface SSEVideoErrorEvent {
  type: 'video_error';
  videoId: string;
  error: string;
}

export interface SSEImageReadyEvent {
  type: 'image_ready';
  imageId: string;
  name: string;
  url: string;
}

export interface SSEAssetSyncCompleteEvent {
  type: 'asset_sync_complete';
  imagesCount: number;
  videosCount: number;
}

export interface SSEVideoSyncedEvent {
  type: 'video_synced';
  videoId: string;
  name: string;
  url: string;
  thumbnailUrl: string;
}

// New validation events
export interface SSEImageValidatedEvent {
  type: 'image_validated';
  imageId: string;
  status: AssetStatus;
  errors: string[];
  aspectRatio: string | null;
}

export interface SSEVideoValidatedEvent {
  type: 'video_validated';
  videoId: string;
  status: AssetStatus;
  errors: string[];
  aspectRatio: string | null;
  width: number | null;
  height: number | null;
  duration: number | null;
}

export interface SSEImageEligibilityCheckedEvent {
  type: 'image_eligibility_checked';
  imageId: string;
  facebookEligible: boolean;
  instagramEligible: boolean;
  googleEligible: boolean;
  error: string | null;
}

export interface SSEVideoEligibilityCheckedEvent {
  type: 'video_eligibility_checked';
  videoId: string;
  facebookEligible: boolean;
  instagramEligible: boolean;
  error: string | null;
}

export interface SSEYouTubeVideoReadyEvent {
  type: 'youtube_video_ready';
  videoId: string;
  youtubeVideoId: string;
}

export interface SSEYouTubeVideoErrorEvent {
  type: 'youtube_video_error';
  videoId: string;
  error: string;
}

export interface SSECampaignProgressEvent {
  type: 'campaign_progress';
  campaignId: string;
  step: string;
  progress: number;
  message: string;
}

export interface SSECampaignCompleteEvent {
  type: 'campaign_complete';
  campaignId: string;
}

export interface SSECampaignErrorEvent {
  type: 'campaign_error';
  campaignId: string;
  error: string;
}

export type SSEEvent =
  | SSEConnectedEvent
  | SSEHeartbeatEvent
  | SSEVideoReadyEvent
  | SSEVideoErrorEvent
  | SSEImageReadyEvent
  | SSEAssetSyncCompleteEvent
  | SSEVideoSyncedEvent
  | SSEImageValidatedEvent
  | SSEVideoValidatedEvent
  | SSEImageEligibilityCheckedEvent
  | SSEVideoEligibilityCheckedEvent
  | SSEYouTubeVideoReadyEvent
  | SSEYouTubeVideoErrorEvent
  | SSECampaignProgressEvent
  | SSECampaignCompleteEvent
  | SSECampaignErrorEvent;
