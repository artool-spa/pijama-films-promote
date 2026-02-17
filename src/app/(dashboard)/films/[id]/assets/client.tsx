'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Container,
  Box,
  Typography,
  Button,
  Card,
  CardMedia,
  CardContent,
  CardActions,
  Chip,
  ToggleButtonGroup,
  ToggleButton,
  Alert,
  Tooltip,
  IconButton,
  LinearProgress,
  CircularProgress,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
} from '@mui/material';
import {
  ArrowBack as ArrowBackIcon,
  CloudUpload as CloudUploadIcon,
  Facebook as FacebookIcon,
  Instagram as InstagramIcon,
  YouTube as YouTubeIcon,
  Warning as WarningIcon,
  Refresh as RefreshIcon,
  Crop as CropIcon,
  Delete as DeleteIcon,
  ExpandMore as ExpandMoreIcon,
  CheckCircle as CheckCircleIcon,
} from '@mui/icons-material';
import type { Film } from '@/models/film';
import type { ImageWithUsage } from '@/models/image';
import type { VideoWithUsage } from '@/models/video';
import { AD_FORMATS, CROP_ASPECT_RATIOS, hasVerticalAsset, hasAssetForRatio, getAspectRatioLabel } from '@/lib/assets/formats';
import { ASSET_STATUS_LABELS, ASSET_STATUS_COLORS } from '@/lib/assets/labels';
import type { AssetStatus } from '@prisma/client';
import CropDialog from './CropDialog';

// Custom styles for status chips (default color doesn't have fill)
const ASSET_STATUS_STYLES: Record<AssetStatus, object> = {
  PENDING: { bgcolor: 'grey.400', color: 'white' },
  VALIDATING: {},
  READY: {},
  INVALID: {},
  ERROR: {},
};

// Local asset type for state management
type LocalImage = ImageWithUsage;
type LocalVideo = VideoWithUsage;

type AssetFilter = 'all' | 'ready' | 'validating' | 'invalid';

type AssetsClientProps = {
  film: Film;
  images: ImageWithUsage[];
  videos: VideoWithUsage[];
  returnTo?: string;
  draftId?: string;
};

// Aspect ratio to format string mapping
const RATIO_TO_FORMAT: Record<string, string> = {
  '9:16': '9:16',
  '16:9': '16:9',
  '4:5': '4:5',
  '1:1': '1:1',
};

export default function AssetsClient({ film, images: initialImages, videos: initialVideos, returnTo, draftId }: AssetsClientProps) {
  const router = useRouter();

  // Asset state
  const [imageAssets, setImageAssets] = useState<LocalImage[]>(initialImages);
  const [videoAssets, setVideoAssets] = useState<LocalVideo[]>(initialVideos);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('ready');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Crop dialog state
  const [cropImage, setCropImage] = useState<LocalImage | null>(null);

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);

  // Filter assets
  const filteredImages = useMemo(() => {
    if (assetFilter === 'all') return imageAssets;
    if (assetFilter === 'ready') return imageAssets.filter((a) => a.status === 'READY');
    if (assetFilter === 'validating') return imageAssets.filter((a) => a.status === 'VALIDATING' || a.status === 'PENDING');
    return imageAssets.filter((a) => a.status === 'INVALID' || a.status === 'ERROR');
  }, [imageAssets, assetFilter]);

  const filteredVideos = useMemo(() => {
    if (assetFilter === 'all') return videoAssets;
    if (assetFilter === 'ready') return videoAssets.filter((a) => a.status === 'READY');
    if (assetFilter === 'validating') return videoAssets.filter((a) => a.status === 'VALIDATING' || a.status === 'PENDING');
    return videoAssets.filter((a) => a.status === 'INVALID' || a.status === 'ERROR');
  }, [videoAssets, assetFilter]);

  // All assets combined for format checking
  const allImages = imageAssets;
  const allVideos = videoAssets;

  // File upload handler
  const handleFileUpload = useCallback(async (files: FileList) => {
    setUploading(true);
    setUploadError(null);

    for (const file of Array.from(files)) {
      const isVideo = file.type.startsWith('video/');
      const baseEndpoint = isVideo ? '/api/upload/video' : '/api/upload/image';
      const params = new URLSearchParams({
        filmMuviUuid: film.id,
        name: file.name,
      });
      const endpoint = `${baseEndpoint}?${params.toString()}`;

      // Client-side validation
      const maxSize = isVideo ? 500 * 1024 * 1024 : 10 * 1024 * 1024;
      if (file.size > maxSize) {
        setUploadError(`${file.name}: File too large`);
        continue;
      }

      const formData = new FormData();
      formData.append('file', file);

      try {
        const res = await fetch(endpoint, { method: 'POST', body: formData });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Upload failed');
        }
        const result = await res.json();

        if (isVideo) {
          const newVideo: LocalVideo = {
            id: result.id,
            filmMuviUuid: result.filmMuviUuid,
            name: result.name,
            originalUrl: result.originalUrl,
            storageKey: result.storageKey,
            url: result.url,
            mimeType: result.mimeType,
            size: result.size,
            duration: result.duration,
            thumbnailUrl: result.thumbnailUrl,
            metaVideoId: result.metaVideoId,
            createdAt: new Date(result.createdAt),
            status: result.status || 'PENDING',
            validatedAt: result.validatedAt ? new Date(result.validatedAt) : null,
            validationError: result.validationError,
            width: result.width,
            height: result.height,
            aspectRatio: result.aspectRatio,
            facebookEligible: result.facebookEligible || false,
            instagramEligible: result.instagramEligible || false,
            youtubeEligible: result.youtubeEligible || false,
            youtubeVideoId: result.youtubeVideoId || null,
            eligibilityError: result.eligibilityError,
            _count: { ads: 0 },
          };
          setVideoAssets((prev) => [newVideo, ...prev]);
          setAssetFilter('validating');
        } else {
          const newImage: LocalImage = {
            id: result.id,
            filmMuviUuid: result.filmMuviUuid,
            name: result.name,
            originalUrl: result.originalUrl,
            storageKey: result.storageKey,
            url: result.url,
            mimeType: result.mimeType,
            size: result.size,
            width: result.width,
            height: result.height,
            createdAt: new Date(result.createdAt),
            status: result.status || 'PENDING',
            validatedAt: result.validatedAt ? new Date(result.validatedAt) : null,
            validationError: result.validationError,
            aspectRatio: result.aspectRatio,
            metaImageHash: result.metaImageHash,
            facebookEligible: result.facebookEligible || false,
            instagramEligible: result.instagramEligible || false,
            eligibilityError: result.eligibilityError,
            _count: { ads: 0 },
          };
          setImageAssets((prev) => [newImage, ...prev]);
        }
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      }
    }
    setUploading(false);
  }, [film.id]);

  // Revalidate handler
  const handleRevalidate = useCallback(async (assetId: string, type: 'image' | 'video') => {
    try {
      const res = await fetch(`/api/assets/${assetId}/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, filmMuviUuid: film.id }),
      });
      if (res.ok) {
        // Optimistically set status to VALIDATING
        if (type === 'image') {
          setImageAssets((prev) =>
            prev.map((a) => (a.id === assetId ? { ...a, status: 'VALIDATING' as const } : a))
          );
        } else {
          setVideoAssets((prev) =>
            prev.map((a) => (a.id === assetId ? { ...a, status: 'VALIDATING' as const } : a))
          );
        }
      }
    } catch (err) {
      console.error('Error revalidating asset:', err);
    }
  }, [film.id]);

  // Delete handler
  const handleDelete = useCallback(async (assetId: string, type: 'image' | 'video') => {
    setDeleting(assetId);
    try {
      const endpoint = type === 'image' ? `/api/images/${assetId}` : `/api/videos/${assetId}`;
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (res.ok) {
        if (type === 'image') {
          setImageAssets((prev) => prev.filter((a) => a.id !== assetId));
        } else {
          setVideoAssets((prev) => prev.filter((a) => a.id !== assetId));
        }
      } else {
        const err = await res.json();
        setUploadError(err.error || 'Failed to delete');
      }
    } catch (err) {
      console.error('Error deleting asset:', err);
      setUploadError('Failed to delete file');
    } finally {
      setDeleting(null);
    }
  }, []);

  // Crop complete handler
  const handleCropComplete = useCallback((newImage: LocalImage) => {
    setImageAssets((prev) => [newImage, ...prev]);
  }, []);

  // SSE listener for real-time validation updates
  useEffect(() => {
    const mercureUrl = new URL(process.env.NEXT_PUBLIC_MERCURE_URL!);
    mercureUrl.searchParams.set('topic', `https://promote.pijamafilms.com/films/${film.id}/events`);
    const eventSource = new EventSource(mercureUrl.toString());

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle new images from MUVI sync
        if (data.type === 'image_ready') {
          setImageAssets((prev) => {
            if (prev.some((a) => a.id === data.imageId)) return prev;
            return [
              {
                id: data.imageId,
                filmMuviUuid: film.id,
                name: data.name,
                originalUrl: data.url,
                storageKey: '',
                url: data.url,
                mimeType: 'image/jpeg',
                size: 0,
                width: null,
                height: null,
                createdAt: new Date(),
                status: 'PENDING' as const,
                validatedAt: null,
                validationError: null,
                aspectRatio: null,
                metaImageHash: null,
                facebookEligible: false,
                instagramEligible: false,
                eligibilityError: null,
                _count: { ads: 0 },
              },
              ...prev,
            ];
          });
        }

        // Handle new videos from MUVI sync
        if (data.type === 'video_synced') {
          setVideoAssets((prev) => {
            if (prev.some((a) => a.id === data.videoId)) return prev;
            return [
              {
                id: data.videoId,
                filmMuviUuid: film.id,
                name: data.name,
                originalUrl: data.url,
                storageKey: '',
                url: data.url,
                mimeType: 'video/mp4',
                size: 0,
                duration: null,
                thumbnailUrl: data.thumbnailUrl || null,
                metaVideoId: null,
                createdAt: new Date(),
                status: 'PENDING' as const,
                validatedAt: null,
                validationError: null,
                width: null,
                height: null,
                aspectRatio: null,
                facebookEligible: false,
                instagramEligible: false,
                youtubeEligible: false,
                youtubeVideoId: null,
                eligibilityError: null,
                _count: { ads: 0 },
              },
              ...prev,
            ];
          });
        }

        // Handle image validation events
        if (data.type === 'image_validated') {
          setImageAssets((prev) =>
            prev.map((a) =>
              a.id === data.imageId
                ? {
                    ...a,
                    status: data.status as AssetStatus,
                    validationError: data.errors?.join('; ') || null,
                    aspectRatio: data.aspectRatio,
                  }
                : a
            )
          );
        }

        // Handle video validation events
        if (data.type === 'video_validated') {
          setVideoAssets((prev) =>
            prev.map((a) =>
              a.id === data.videoId
                ? {
                    ...a,
                    status: data.status as AssetStatus,
                    validationError: data.errors?.join('; ') || null,
                    aspectRatio: data.aspectRatio,
                  }
                : a
            )
          );
        }

        // Handle image eligibility events
        if (data.type === 'image_eligibility_checked') {
          setImageAssets((prev) =>
            prev.map((a) =>
              a.id === data.imageId
                ? {
                    ...a,
                    facebookEligible: data.facebookEligible,
                    instagramEligible: data.instagramEligible,
                    eligibilityError: data.error,
                  }
                : a
            )
          );
        }

        // Handle video eligibility events
        if (data.type === 'video_eligibility_checked') {
          setVideoAssets((prev) =>
            prev.map((a) =>
              a.id === data.videoId
                ? {
                    ...a,
                    facebookEligible: data.facebookEligible,
                    instagramEligible: data.instagramEligible,
                    eligibilityError: data.error,
                  }
                : a
            )
          );
        }
      } catch (err) {
        console.error('[SSE] Error parsing event:', err);
      }
    };

    return () => eventSource.close();
  }, [film.id]);

  // Back button handler
  const handleBack = () => {
    if (returnTo === 'campaign' && draftId) {
      router.push(`/films/${film.id}/campaigns/new?draft=${draftId}`);
    } else if (returnTo === 'campaign') {
      router.push(`/films/${film.id}/campaigns/new`);
    } else {
      router.push('/films');
    }
  };

  const showVerticalWarning = !hasVerticalAsset(allImages, allVideos);

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 3 }}>
        <Button
          startIcon={<ArrowBackIcon />}
          onClick={handleBack}
          variant="text"
        >
          {returnTo === 'campaign' ? 'Back to Campaign' : 'Back'}
        </Button>
        <Typography variant="h4" component="h1" sx={{ flexGrow: 1 }}>
          Assets: {film.title}
        </Typography>
      </Box>

      {/* Format Reference Table */}
      <Accordion defaultExpanded sx={{ mb: 3 }}>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <Typography variant="h6">Ad Formats</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <TableContainer component={Paper} variant="outlined">
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Format</TableCell>
                  <TableCell>Dimensions</TableCell>
                  <TableCell>Max Duration</TableCell>
                  <TableCell>Placements</TableCell>
                  <TableCell align="center">Status</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {AD_FORMATS.map((format) => {
                  const ratioStr = Object.entries(RATIO_TO_FORMAT).find(
                    ([, v]) => v === format.name.match(/\(([^)]+)\)/)?.[1]
                  )?.[0] || '';
                  const hasCoverage = hasAssetForRatio(allImages, allVideos, ratioStr);
                  return (
                    <TableRow key={format.name}>
                      <TableCell>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {format.name}
                          {format.recommended && (
                            <Chip label="Recommended" size="small" color="primary" variant="outlined" />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>{format.width} x {format.height}</TableCell>
                      <TableCell>{format.maxDuration}</TableCell>
                      <TableCell>{format.placements}</TableCell>
                      <TableCell align="center">
                        {hasCoverage ? (
                          <CheckCircleIcon color="success" fontSize="small" />
                        ) : (
                          <Typography variant="caption" color="text.secondary">—</Typography>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </AccordionDetails>
      </Accordion>

      {/* Vertical asset warning */}
      {showVerticalWarning && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          Over 80% of social media users view content vertically. We recommend uploading or cropping at least one 9:16 asset to maximize your campaign reach.
        </Alert>
      )}

      {/* Upload Zone */}
      <Box
        sx={{
          mb: 3,
          p: 3,
          border: '2px dashed',
          borderColor: 'divider',
          borderRadius: 1,
          textAlign: 'center',
          cursor: 'pointer',
          '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (e.dataTransfer.files) handleFileUpload(e.dataTransfer.files);
        }}
        onClick={() => document.getElementById('asset-file-upload')?.click()}
      >
        <input
          id="asset-file-upload"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
          hidden
          onChange={(e) => e.target.files && handleFileUpload(e.target.files)}
        />
        <CloudUploadIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
        <Typography>Drag files here or click to select</Typography>
        <Typography variant="caption" color="text.secondary">
          Images: JPG, PNG, WebP, GIF (max 10MB) | Videos: MP4, WebM, MOV (max 500MB)
        </Typography>
      </Box>

      {uploading && <LinearProgress sx={{ mb: 2 }} />}
      {uploadError && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setUploadError(null)}>
          {uploadError}
        </Alert>
      )}

      {/* Filter Controls */}
      <Box sx={{ mb: 3 }}>
        <ToggleButtonGroup
          value={assetFilter}
          exclusive
          onChange={(_, value) => value && setAssetFilter(value)}
          size="small"
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="ready">Ready</ToggleButton>
          <ToggleButton value="validating">Validating</ToggleButton>
          <ToggleButton value="invalid">Invalid</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Videos Section */}
      <Typography variant="h6" gutterBottom>
        Videos ({filteredVideos.length})
      </Typography>
      {filteredVideos.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          No videos {assetFilter !== 'all' ? 'match this filter' : 'yet'}.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          {filteredVideos.map((asset) => (
            <Card
              key={asset.id}
              sx={{
                width: 200,
                position: 'relative',
                opacity: asset.status === 'INVALID' || asset.status === 'ERROR' ? 0.7 : 1,
              }}
            >
              {/* Status chip */}
              <Chip
                label={ASSET_STATUS_LABELS[asset.status]}
                size="small"
                color={ASSET_STATUS_COLORS[asset.status]}
                sx={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  fontSize: '0.65rem',
                  height: 20,
                  zIndex: 1,
                  ...ASSET_STATUS_STYLES[asset.status],
                }}
              />

              {/* Validating overlay */}
              {asset.status === 'VALIDATING' && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    bgcolor: 'rgba(255,255,255,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1,
                  }}
                >
                  <CircularProgress size={24} />
                </Box>
              )}

              <CardMedia
                component="img"
                height="112"
                image={asset.thumbnailUrl || asset.url}
                alt={asset.name}
                sx={{ objectFit: 'cover' }}
              />
              <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                <Typography variant="caption" noWrap sx={{ fontSize: '0.75rem', display: 'block', fontWeight: 500 }}>
                  {asset.name}
                </Typography>
                {asset.aspectRatio && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>
                    {getAspectRatioLabel(asset.aspectRatio)} ({asset.aspectRatio})
                    {asset.width && asset.height && ` · ${asset.width}x${asset.height}`}
                  </Typography>
                )}
                {/* Platform eligibility icons */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  {asset.status === 'READY' && (
                    <>
                      {asset.facebookEligible && (
                        <Tooltip title="Facebook">
                          <FacebookIcon sx={{ fontSize: 14, color: '#1877F2' }} />
                        </Tooltip>
                      )}
                      {asset.instagramEligible && (
                        <Tooltip title="Instagram">
                          <InstagramIcon sx={{ fontSize: 14, color: '#E4405F' }} />
                        </Tooltip>
                      )}
                    </>
                  )}
                  {(asset.status === 'INVALID' || asset.status === 'ERROR') && (
                    <Tooltip title={asset.validationError || asset.eligibilityError || 'Validation failed'}>
                      <WarningIcon sx={{ fontSize: 14, color: 'warning.main' }} />
                    </Tooltip>
                  )}
                </Box>
                {/* Usage badge */}
                {asset._count.ads > 0 && (
                  <Chip
                    label={`Used in ${asset._count.ads} ${asset._count.ads === 1 ? 'ad' : 'ads'}`}
                    size="small"
                    variant="outlined"
                    sx={{ mt: 0.5, fontSize: '0.65rem', height: 18 }}
                  />
                )}
              </CardContent>
              <CardActions sx={{ p: 0.5, pt: 0, justifyContent: 'flex-end' }}>
                {(asset.status === 'INVALID' || asset.status === 'ERROR') && (
                  <Tooltip title="Retry validation">
                    <IconButton size="small" onClick={() => handleRevalidate(asset.id, 'video')}>
                      <RefreshIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </CardActions>
            </Card>
          ))}
        </Box>
      )}

      {/* Images Section */}
      <Typography variant="h6" gutterBottom>
        Images ({filteredImages.length})
      </Typography>
      {filteredImages.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          No images {assetFilter !== 'all' ? 'match this filter' : 'yet'}.
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
          {filteredImages.map((asset) => (
            <Card
              key={asset.id}
              sx={{
                width: 200,
                position: 'relative',
                opacity: asset.status === 'INVALID' || asset.status === 'ERROR' ? 0.7 : 1,
              }}
            >
              {/* Status chip */}
              <Chip
                label={ASSET_STATUS_LABELS[asset.status]}
                size="small"
                color={ASSET_STATUS_COLORS[asset.status]}
                sx={{
                  position: 'absolute',
                  top: 4,
                  right: 4,
                  fontSize: '0.65rem',
                  height: 20,
                  zIndex: 1,
                  ...ASSET_STATUS_STYLES[asset.status],
                }}
              />

              {/* Validating overlay */}
              {asset.status === 'VALIDATING' && (
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    bgcolor: 'rgba(255,255,255,0.7)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 1,
                  }}
                >
                  <CircularProgress size={24} />
                </Box>
              )}

              <CardMedia
                component="img"
                height="112"
                image={asset.url}
                alt={asset.name}
                sx={{ objectFit: 'cover' }}
              />
              <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                <Typography variant="caption" noWrap sx={{ fontSize: '0.75rem', display: 'block', fontWeight: 500 }}>
                  {asset.name}
                </Typography>
                {asset.aspectRatio && (
                  <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>
                    {getAspectRatioLabel(asset.aspectRatio)} ({asset.aspectRatio})
                    {asset.width && asset.height && ` · ${asset.width}x${asset.height}`}
                  </Typography>
                )}
                {/* Platform eligibility icons */}
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                  {asset.status === 'READY' && (
                    <>
                      {asset.facebookEligible && (
                        <Tooltip title="Facebook">
                          <FacebookIcon sx={{ fontSize: 14, color: '#1877F2' }} />
                        </Tooltip>
                      )}
                      {asset.instagramEligible && (
                        <Tooltip title="Instagram">
                          <InstagramIcon sx={{ fontSize: 14, color: '#E4405F' }} />
                        </Tooltip>
                      )}
                    </>
                  )}
                  {(asset.status === 'INVALID' || asset.status === 'ERROR') && (
                    <Tooltip title={asset.validationError || asset.eligibilityError || 'Validation failed'}>
                      <WarningIcon sx={{ fontSize: 14, color: 'warning.main' }} />
                    </Tooltip>
                  )}
                </Box>
                {/* Usage badge */}
                {asset._count.ads > 0 && (
                  <Chip
                    label={`Used in ${asset._count.ads} ${asset._count.ads === 1 ? 'ad' : 'ads'}`}
                    size="small"
                    variant="outlined"
                    sx={{ mt: 0.5, fontSize: '0.65rem', height: 18 }}
                  />
                )}
              </CardContent>
              <CardActions sx={{ p: 0.5, pt: 0, justifyContent: 'flex-end' }}>
                <Tooltip title="Crop">
                  <IconButton size="small" onClick={() => setCropImage(asset)}>
                    <CropIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                {(asset.status === 'INVALID' || asset.status === 'ERROR') && (
                  <Tooltip title="Retry validation">
                    <IconButton size="small" onClick={() => handleRevalidate(asset.id, 'image')}>
                      <RefreshIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
              </CardActions>
            </Card>
          ))}
        </Box>
      )}

      {/* Crop Dialog */}
      {cropImage && (
        <CropDialog
          open={!!cropImage}
          image={cropImage}
          filmMuviUuid={film.id}
          onClose={() => setCropImage(null)}
          onCropComplete={handleCropComplete}
        />
      )}
    </Container>
  );
}
