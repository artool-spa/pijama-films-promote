export { broadcaster } from './broadcaster';

/**
 * Event types for SSE notifications
 */
export type SSEEventType =
  | 'connected'
  | 'heartbeat'
  | 'video_ready'
  | 'video_error'
  | 'image_ready'
  | 'asset_sync_complete';

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

export type SSEEvent =
  | SSEConnectedEvent
  | SSEHeartbeatEvent
  | SSEVideoReadyEvent
  | SSEVideoErrorEvent
  | SSEImageReadyEvent
  | SSEAssetSyncCompleteEvent
  | SSEVideoSyncedEvent;
