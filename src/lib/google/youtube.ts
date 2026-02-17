import { refreshAccessToken } from './auth';

/**
 * YouTube Data API v3 - Video Upload Client
 *
 * Uploads videos to YouTube as unlisted for use in Google Ads campaigns.
 * Uses resumable upload protocol for reliability with large files.
 * Reuses OAuth2 credentials from Google Ads configuration.
 */

interface YouTubeUploadConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

interface YouTubeUploadResult {
  youtubeVideoId: string;
  title: string;
  status: string;
}

/**
 * Get YouTube API config from environment variables.
 * Reuses Google Ads OAuth credentials (same OAuth app, different scope).
 * A separate refresh token with YouTube scope may be needed.
 */
function getYouTubeConfig(): YouTubeUploadConfig {
  const clientId = process.env.YOUTUBE_CLIENT_ID || process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.YOUTUBE_CLIENT_SECRET || process.env.GOOGLE_ADS_CLIENT_SECRET;
  const refreshToken = process.env.YOUTUBE_REFRESH_TOKEN || process.env.GOOGLE_ADS_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing YouTube API credentials. Set YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, ' +
      'YOUTUBE_REFRESH_TOKEN (or reuse GOOGLE_ADS_* equivalents with YouTube scope).'
    );
  }

  return { clientId, clientSecret, refreshToken };
}

/**
 * Get a fresh access token for YouTube API
 */
async function getYouTubeAccessToken(): Promise<string> {
  const config = getYouTubeConfig();
  return refreshAccessToken(config.clientId, config.clientSecret, config.refreshToken);
}

/**
 * Upload a video to YouTube using resumable upload protocol.
 *
 * Steps:
 * 1. Download the video from the source URL
 * 2. Initiate a resumable upload session with YouTube
 * 3. Upload the video data
 * 4. Return the YouTube video ID
 *
 * Videos are uploaded as "unlisted" so they work for ads but
 * don't appear in the channel's public listing.
 */
export async function uploadVideoToYouTube(
  videoUrl: string,
  title: string,
  description?: string
): Promise<YouTubeUploadResult> {
  const accessToken = await getYouTubeAccessToken();

  // Step 1: Download the video
  const videoResponse = await fetch(videoUrl);
  if (!videoResponse.ok) {
    throw new Error(`Failed to download video from ${videoUrl}: ${videoResponse.status}`);
  }

  const videoBuffer = Buffer.from(await videoResponse.arrayBuffer());
  const contentType = videoResponse.headers.get('content-type') || 'video/mp4';

  // Step 2: Initiate resumable upload
  const metadata = {
    snippet: {
      title: title.substring(0, 100), // YouTube title limit
      description: description?.substring(0, 5000) || `Uploaded for advertising via Pijama Films`,
      categoryId: '1', // Film & Animation
    },
    status: {
      privacyStatus: 'unlisted',
      selfDeclaredMadeForKids: false,
    },
  };

  const initResponse = await fetch(
    'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': videoBuffer.length.toString(),
        'X-Upload-Content-Type': contentType,
      },
      body: JSON.stringify(metadata),
    }
  );

  if (!initResponse.ok) {
    const errorBody = await initResponse.text();
    throw new Error(`YouTube upload initiation failed (${initResponse.status}): ${errorBody}`);
  }

  const uploadUrl = initResponse.headers.get('location');
  if (!uploadUrl) {
    throw new Error('YouTube did not return a resumable upload URL');
  }

  // Step 3: Upload the video data
  const uploadResponse = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': videoBuffer.length.toString(),
    },
    body: videoBuffer,
  });

  if (!uploadResponse.ok) {
    const errorBody = await uploadResponse.text();
    throw new Error(`YouTube video upload failed (${uploadResponse.status}): ${errorBody}`);
  }

  const result = await uploadResponse.json() as {
    id: string;
    snippet?: { title: string };
    status?: { uploadStatus: string };
  };

  if (!result.id) {
    throw new Error('YouTube upload succeeded but no video ID was returned');
  }

  return {
    youtubeVideoId: result.id,
    title: result.snippet?.title || title,
    status: result.status?.uploadStatus || 'uploaded',
  };
}
