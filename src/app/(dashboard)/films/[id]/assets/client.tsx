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
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  TextField,
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
  Edit as EditIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  Archive as ArchiveIcon,
  Unarchive as UnarchiveIcon,
} from '@mui/icons-material';
import type { Film } from '@/models/film';
import type { ImageWithUsage } from '@/models/image';
import type { VideoWithUsage } from '@/models/video';
import { AD_FORMATS, CROP_ASPECT_RATIOS, hasVerticalAsset, hasAssetForRatio, hasImageForRatio, hasVideoForRatio, getAspectRatioLabel } from '@/lib/assets/formats';
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

type AssetFilter = 'all' | 'promotable' | 'ready' | 'validating' | 'archived';

type AssetsClientProps = {
  film: Film;
  images: ImageWithUsage[];
  videos: VideoWithUsage[];
  archivedImages: ImageWithUsage[];
  archivedVideos: VideoWithUsage[];
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

export default function AssetsClient({ film, images: initialImages, videos: initialVideos, archivedImages: initialArchivedImages, archivedVideos: initialArchivedVideos, returnTo, draftId }: AssetsClientProps) {
  const router = useRouter();

  // Asset state
  const [imageAssets, setImageAssets] = useState<LocalImage[]>(initialImages);
  const [videoAssets, setVideoAssets] = useState<LocalVideo[]>(initialVideos);
  const [archivedImageAssets, setArchivedImageAssets] = useState<LocalImage[]>(initialArchivedImages);
  const [archivedVideoAssets, setArchivedVideoAssets] = useState<LocalVideo[]>(initialArchivedVideos);
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('promotable');

  // Upload state
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Crop dialog state
  const [cropImage, setCropImage] = useState<LocalImage | null>(null);

  // Delete state
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; type: 'image' | 'video'; name: string } | null>(null);

  // Rename state
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editNameValue, setEditNameValue] = useState('');
  const [savingName, setSavingName] = useState(false);

  // Filter assets (INVALID assets are always hidden)
  const filteredImages = useMemo(() => {
    const visible = imageAssets.filter((a) => a.status !== 'INVALID');
    if (assetFilter === 'all') return visible;
    if (assetFilter === 'promotable') return visible.filter((a) => a.status === 'READY' || a.status === 'PENDING' || a.status === 'VALIDATING');
    if (assetFilter === 'ready') return visible.filter((a) => a.status === 'READY');
    if (assetFilter === 'validating') return visible.filter((a) => a.status === 'VALIDATING' || a.status === 'PENDING');
    return visible;
  }, [imageAssets, assetFilter]);

  const filteredVideos = useMemo(() => {
    const visible = videoAssets.filter((a) => a.status !== 'INVALID');
    if (assetFilter === 'all') return visible;
    if (assetFilter === 'promotable') return visible.filter((a) => a.status === 'READY' || a.status === 'PENDING' || a.status === 'VALIDATING');
    if (assetFilter === 'ready') return visible.filter((a) => a.status === 'READY');
    if (assetFilter === 'validating') return visible.filter((a) => a.status === 'VALIDATING' || a.status === 'PENDING');
    return visible;
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
            archived: false,
            _count: { ads: 0 },
          };
          setVideoAssets((prev) => [newVideo, ...prev]);
          setAssetFilter('promotable');
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
            archived: false,
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
      const endpoint = type === 'image'
        ? `/api/films/${film.id}/images/${assetId}`
        : `/api/films/${film.id}/videos/${assetId}`;
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (res.ok) {
        if (type === 'image') {
          setImageAssets((prev) => prev.filter((a) => a.id !== assetId));
        } else {
          setVideoAssets((prev) => prev.filter((a) => a.id !== assetId));
        }
      } else {
        const err = await res.json();
        setUploadError(err.error || 'Error al eliminar');
      }
    } catch (err) {
      console.error('Error deleting asset:', err);
      setUploadError('Error al eliminar archivo');
    } finally {
      setDeleting(null);
      setDeleteTarget(null);
    }
  }, [film.id]);

  // Rename handler
  const handleRename = useCallback(async (assetId: string, type: 'image' | 'video', newName: string) => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setSavingName(true);
    try {
      const endpoint = type === 'image'
        ? `/api/films/${film.id}/images/${assetId}`
        : `/api/films/${film.id}/videos/${assetId}`;
      const res = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        if (type === 'image') {
          setImageAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, name: trimmed } : a)));
        } else {
          setVideoAssets((prev) => prev.map((a) => (a.id === assetId ? { ...a, name: trimmed } : a)));
        }
      } else {
        const err = await res.json();
        setUploadError(err.error || 'Error al renombrar');
      }
    } catch {
      setUploadError('Error al renombrar archivo');
    } finally {
      setSavingName(false);
      setEditingName(null);
    }
  }, [film.id]);

  // Archive handler
  const handleArchive = useCallback(async (assetId: string, type: 'image' | 'video') => {
    const endpoint = type === 'image'
      ? `/api/films/${film.id}/images/${assetId}/archive`
      : `/api/films/${film.id}/videos/${assetId}/archive`;
    try {
      const res = await fetch(endpoint, { method: 'POST' });
      if (res.ok) {
        if (type === 'image') {
          const asset = imageAssets.find((a) => a.id === assetId);
          if (asset) {
            setImageAssets((prev) => prev.filter((a) => a.id !== assetId));
            setArchivedImageAssets((prev) => [{ ...asset, archived: true }, ...prev]);
          }
        } else {
          const asset = videoAssets.find((a) => a.id === assetId);
          if (asset) {
            setVideoAssets((prev) => prev.filter((a) => a.id !== assetId));
            setArchivedVideoAssets((prev) => [{ ...asset, archived: true }, ...prev]);
          }
        }
      } else {
        const err = await res.json();
        setUploadError(err.error || 'Error al archivar');
      }
    } catch {
      setUploadError('Error al archivar archivo');
    }
  }, [film.id, imageAssets, videoAssets]);

  // Unarchive handler
  const handleUnarchive = useCallback(async (assetId: string, type: 'image' | 'video') => {
    const endpoint = type === 'image'
      ? `/api/films/${film.id}/images/${assetId}/archive`
      : `/api/films/${film.id}/videos/${assetId}/archive`;
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (res.ok) {
        if (type === 'image') {
          const asset = archivedImageAssets.find((a) => a.id === assetId);
          if (asset) {
            setArchivedImageAssets((prev) => prev.filter((a) => a.id !== assetId));
            setImageAssets((prev) => [{ ...asset, archived: false }, ...prev]);
          }
        } else {
          const asset = archivedVideoAssets.find((a) => a.id === assetId);
          if (asset) {
            setArchivedVideoAssets((prev) => prev.filter((a) => a.id !== assetId));
            setVideoAssets((prev) => [{ ...asset, archived: false }, ...prev]);
          }
        }
      } else {
        const err = await res.json();
        setUploadError(err.error || 'Error al desarchivar');
      }
    } catch {
      setUploadError('Error al desarchivar archivo');
    }
  }, [film.id, archivedImageAssets, archivedVideoAssets]);

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
                archived: false,
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
                archived: false,
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
                  <TableCell>Media Types</TableCell>
                  <TableCell>Placements</TableCell>
                  <TableCell align="center">Video</TableCell>
                  <TableCell align="center">Image</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {AD_FORMATS.map((format) => {
                  const ratioStr = Object.entries(RATIO_TO_FORMAT).find(
                    ([, v]) => v === format.name.match(/\(([^)]+)\)/)?.[1]
                  )?.[0] || '';
                  const hasVideo = hasVideoForRatio(allVideos, ratioStr);
                  const hasImage = hasImageForRatio(allImages, ratioStr);
                  return (
                    <TableRow key={format.name}>
                      <TableCell>
                        <Box>
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                            {format.name}
                            {format.recommended && (
                              <Chip label="Recommended" size="small" color="primary" variant="outlined" />
                            )}
                          </Box>
                          {format.note && (
                            <Typography variant="caption" color="text.secondary">
                              {format.note}
                            </Typography>
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>{format.width} x {format.height}</TableCell>
                      <TableCell>{format.maxDuration}</TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.5 }}>
                          {format.mediaTypes.includes('video') && (
                            <Chip label="Video" size="small" variant="outlined" />
                          )}
                          {format.mediaTypes.includes('image') && (
                            <Chip label="Image" size="small" variant="outlined" />
                          )}
                        </Box>
                      </TableCell>
                      <TableCell>{format.placements}</TableCell>
                      <TableCell align="center">
                        {format.mediaTypes.includes('video') ? (
                          hasVideo ? (
                            <CheckCircleIcon color="success" fontSize="small" />
                          ) : (
                            <Typography variant="caption" color="text.secondary">—</Typography>
                          )
                        ) : (
                          <Typography variant="caption" color="text.secondary">N/A</Typography>
                        )}
                      </TableCell>
                      <TableCell align="center">
                        {format.mediaTypes.includes('image') ? (
                          hasImage ? (
                            <CheckCircleIcon color="success" fontSize="small" />
                          ) : (
                            <Typography variant="caption" color="text.secondary">—</Typography>
                          )
                        ) : (
                          <Typography variant="caption" color="text.secondary">N/A</Typography>
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
          <ToggleButton value="promotable">Promotable</ToggleButton>
          <ToggleButton value="ready">Ready</ToggleButton>
          <ToggleButton value="validating">Validating</ToggleButton>
          <ToggleButton value="archived">
            Archived ({archivedImageAssets.length + archivedVideoAssets.length})
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Active Assets (hidden when viewing archived) */}
      {assetFilter !== 'archived' && (<>
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

              {/* Validating/Pending overlay */}
              {(asset.status === 'VALIDATING' || asset.status === 'PENDING') && (
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

              {asset.thumbnailUrl ? (
                <CardMedia
                  component="img"
                  height="112"
                  image={asset.thumbnailUrl}
                  alt={asset.name}
                  sx={{ objectFit: 'cover' }}
                />
              ) : (
                <Box
                  sx={{
                    height: 112,
                    bgcolor: 'grey.200',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {asset.status === 'PENDING' ? (
                    <CloudUploadIcon sx={{ fontSize: 36, color: 'grey.400' }} />
                  ) : (
                    <YouTubeIcon sx={{ fontSize: 36, color: 'grey.400' }} />
                  )}
                </Box>
              )}
              <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                {editingName === asset.id ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <TextField
                      size="small"
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(asset.id, 'video', editNameValue);
                        if (e.key === 'Escape') setEditingName(null);
                      }}
                      disabled={savingName}
                      autoFocus
                      fullWidth
                      sx={{ '& .MuiInputBase-input': { fontSize: '0.75rem', py: 0.25, px: 0.5 } }}
                    />
                    <IconButton size="small" onClick={() => handleRename(asset.id, 'video', editNameValue)} disabled={savingName}>
                      <CheckIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                    <IconButton size="small" onClick={() => setEditingName(null)} disabled={savingName}>
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <Typography variant="caption" noWrap sx={{ fontSize: '0.75rem', fontWeight: 500, flex: 1 }}>
                      {asset.name}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => { setEditingName(asset.id); setEditNameValue(asset.name); }}
                      sx={{ p: 0.25 }}
                    >
                      <EditIcon sx={{ fontSize: 12 }} />
                    </IconButton>
                  </Box>
                )}
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
                {(asset.status === 'ERROR') && (asset.validationError || asset.eligibilityError) && (
                  <Alert severity="warning" sx={{ mt: 0.5, py: 0, px: 0.5, fontSize: '0.65rem', '& .MuiAlert-message': { fontSize: '0.65rem', p: 0.25 }, '& .MuiAlert-icon': { fontSize: '0.85rem', mr: 0.5, p: 0 } }}>
                    {asset.validationError || asset.eligibilityError}
                  </Alert>
                )}
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
                  <Tooltip title="Reintentar validación">
                    <IconButton size="small" onClick={() => handleRevalidate(asset.id, 'video')}>
                      <RefreshIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title="Archivar">
                  <IconButton size="small" onClick={() => handleArchive(asset.id, 'video')}>
                    <ArchiveIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={asset._count.ads > 0 ? 'No se puede eliminar, usado en anuncios' : 'Eliminar'}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => setDeleteTarget({ id: asset.id, type: 'video', name: asset.name })}
                      disabled={asset._count.ads > 0 || deleting === asset.id}
                    >
                      {deleting === asset.id ? <CircularProgress size={16} /> : <DeleteIcon sx={{ fontSize: 16 }} />}
                    </IconButton>
                  </span>
                </Tooltip>
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

              {/* Validating/Pending overlay */}
              {(asset.status === 'VALIDATING' || asset.status === 'PENDING') && (
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
                {editingName === asset.id ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <TextField
                      size="small"
                      value={editNameValue}
                      onChange={(e) => setEditNameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(asset.id, 'image', editNameValue);
                        if (e.key === 'Escape') setEditingName(null);
                      }}
                      disabled={savingName}
                      autoFocus
                      fullWidth
                      sx={{ '& .MuiInputBase-input': { fontSize: '0.75rem', py: 0.25, px: 0.5 } }}
                    />
                    <IconButton size="small" onClick={() => handleRename(asset.id, 'image', editNameValue)} disabled={savingName}>
                      <CheckIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                    <IconButton size="small" onClick={() => setEditingName(null)} disabled={savingName}>
                      <CloseIcon sx={{ fontSize: 14 }} />
                    </IconButton>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25 }}>
                    <Typography variant="caption" noWrap sx={{ fontSize: '0.75rem', fontWeight: 500, flex: 1 }}>
                      {asset.name}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => { setEditingName(asset.id); setEditNameValue(asset.name); }}
                      sx={{ p: 0.25 }}
                    >
                      <EditIcon sx={{ fontSize: 12 }} />
                    </IconButton>
                  </Box>
                )}
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
                {(asset.status === 'ERROR') && (asset.validationError || asset.eligibilityError) && (
                  <Alert severity="warning" sx={{ mt: 0.5, py: 0, px: 0.5, fontSize: '0.65rem', '& .MuiAlert-message': { fontSize: '0.65rem', p: 0.25 }, '& .MuiAlert-icon': { fontSize: '0.85rem', mr: 0.5, p: 0 } }}>
                    {asset.validationError || asset.eligibilityError}
                  </Alert>
                )}
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
                <Tooltip title="Recortar">
                  <IconButton size="small" onClick={() => setCropImage(asset)}>
                    <CropIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                {(asset.status === 'INVALID' || asset.status === 'ERROR') && (
                  <Tooltip title="Reintentar validación">
                    <IconButton size="small" onClick={() => handleRevalidate(asset.id, 'image')}>
                      <RefreshIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Tooltip>
                )}
                <Tooltip title="Archivar">
                  <IconButton size="small" onClick={() => handleArchive(asset.id, 'image')}>
                    <ArchiveIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title={asset._count.ads > 0 ? 'No se puede eliminar, usado en anuncios' : 'Eliminar'}>
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => setDeleteTarget({ id: asset.id, type: 'image', name: asset.name })}
                      disabled={asset._count.ads > 0 || deleting === asset.id}
                    >
                      {deleting === asset.id ? <CircularProgress size={16} /> : <DeleteIcon sx={{ fontSize: 16 }} />}
                    </IconButton>
                  </span>
                </Tooltip>
              </CardActions>
            </Card>
          ))}
        </Box>
      )}
      </>)}

      {/* Archived Assets View */}
      {assetFilter === 'archived' && (
        <>
          <Typography variant="h6" gutterBottom>
            Archived Videos ({archivedVideoAssets.length})
          </Typography>
          {archivedVideoAssets.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              No archived videos.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
              {archivedVideoAssets.map((asset) => (
                <Card key={asset.id} sx={{ width: 200, position: 'relative', opacity: 0.8 }}>
                  <Chip
                    label="Archived"
                    size="small"
                    sx={{
                      position: 'absolute', top: 4, right: 4, fontSize: '0.65rem', height: 20, zIndex: 1,
                      bgcolor: 'grey.500', color: 'white',
                    }}
                  />
                  {asset.thumbnailUrl ? (
                    <CardMedia component="img" height="112" image={asset.thumbnailUrl} alt={asset.name} sx={{ objectFit: 'cover' }} />
                  ) : (
                    <Box sx={{ height: 112, bgcolor: 'grey.200', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <YouTubeIcon sx={{ fontSize: 36, color: 'grey.400' }} />
                    </Box>
                  )}
                  <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                    <Typography variant="caption" noWrap sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                      {asset.name}
                    </Typography>
                    {asset.aspectRatio && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>
                        {getAspectRatioLabel(asset.aspectRatio)} ({asset.aspectRatio})
                      </Typography>
                    )}
                  </CardContent>
                  <CardActions sx={{ p: 0.5, pt: 0, justifyContent: 'flex-end' }}>
                    <Tooltip title="Desarchivar">
                      <IconButton size="small" onClick={() => handleUnarchive(asset.id, 'video')}>
                        <UnarchiveIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </CardActions>
                </Card>
              ))}
            </Box>
          )}

          <Typography variant="h6" gutterBottom>
            Archived Images ({archivedImageAssets.length})
          </Typography>
          {archivedImageAssets.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              No archived images.
            </Typography>
          ) : (
            <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
              {archivedImageAssets.map((asset) => (
                <Card key={asset.id} sx={{ width: 200, position: 'relative', opacity: 0.8 }}>
                  <Chip
                    label="Archived"
                    size="small"
                    sx={{
                      position: 'absolute', top: 4, right: 4, fontSize: '0.65rem', height: 20, zIndex: 1,
                      bgcolor: 'grey.500', color: 'white',
                    }}
                  />
                  <CardMedia component="img" height="112" image={asset.url} alt={asset.name} sx={{ objectFit: 'cover' }} />
                  <CardContent sx={{ p: 1, '&:last-child': { pb: 1 } }}>
                    <Typography variant="caption" noWrap sx={{ fontSize: '0.75rem', fontWeight: 500 }}>
                      {asset.name}
                    </Typography>
                    {asset.aspectRatio && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', fontSize: '0.7rem' }}>
                        {getAspectRatioLabel(asset.aspectRatio)} ({asset.aspectRatio})
                      </Typography>
                    )}
                  </CardContent>
                  <CardActions sx={{ p: 0.5, pt: 0, justifyContent: 'flex-end' }}>
                    <Tooltip title="Desarchivar">
                      <IconButton size="small" onClick={() => handleUnarchive(asset.id, 'image')}>
                        <UnarchiveIcon sx={{ fontSize: 16 }} />
                      </IconButton>
                    </Tooltip>
                  </CardActions>
                </Card>
              ))}
            </Box>
          )}
        </>
      )}

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteTarget} onClose={() => setDeleteTarget(null)}>
        <DialogTitle>Eliminar archivo</DialogTitle>
        <DialogContent>
          <DialogContentText>
            ¿Estás seguro de que quieres eliminar &quot;{deleteTarget?.name}&quot;? Esta acción no se puede deshacer.
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button
            color="error"
            onClick={() => deleteTarget && handleDelete(deleteTarget.id, deleteTarget.type)}
            disabled={!!deleting}
          >
            {deleting ? 'Eliminando...' : 'Eliminar'}
          </Button>
        </DialogActions>
      </Dialog>

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
