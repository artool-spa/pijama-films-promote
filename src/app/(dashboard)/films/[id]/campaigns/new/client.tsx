'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import {
  Container,
  Box,
  Typography,
  Grid,
  Paper,
  Tabs,
  Tab,
  Button,
  TextField,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  Autocomplete,
  RadioGroup,
  FormControlLabel,
  Radio,
  Card,
  CardMedia,
  CardContent,
  Divider,
  ToggleButtonGroup,
  ToggleButton,
  Checkbox,
  FormGroup,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  IconButton,
  CircularProgress,
  LinearProgress,
  Alert,
} from '@mui/material';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  CloudUpload as CloudUploadIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
} from '@mui/icons-material';
import type { Film } from '@/models/film';

// Type for local database assets passed from server
type LocalAsset = {
  id: string;
  type: 'image' | 'video';
  name: string;
  url: string;
  thumbnailUrl: string;
  storageKey: string;
  metaVideoId?: string | null; // For videos uploaded to Meta
};

type CreateCampaignClientProps = {
  film: Film;
  localImages: LocalAsset[];
  localVideos: LocalAsset[];
};

// Type for uploaded assets (newly uploaded during this session)
type UploadedAsset = {
  id: string;
  type: 'image' | 'video';
  name: string;
  url: string;
  thumbnailUrl: string;
  storageKey: string;
  metaVideoId?: string | null; // For videos uploaded to Meta
};

// Platform configurations with ad styles (META platforms only)
const PLATFORMS = [
  { id: 'facebook', name: 'Facebook', adStyles: ['Feed', 'Stories', 'Reels'] },
  { id: 'instagram', name: 'Instagram', adStyles: ['Feed', 'Stories', 'Reels'] },
];

// Location type from Meta API
type MetaLocation = {
  key: string;
  name: string;
  type: string;
  country_code?: string;
  country_name?: string;
  region?: string;
};

// Default countries for initial load and fallback
const DEFAULT_COUNTRIES: MetaLocation[] = [
  { key: 'CL', name: 'Chile', type: 'country', country_code: 'CL' },
  { key: 'AR', name: 'Argentina', type: 'country', country_code: 'AR' },
  { key: 'MX', name: 'Mexico', type: 'country', country_code: 'MX' },
  { key: 'ES', name: 'Spain', type: 'country', country_code: 'ES' },
  { key: 'US', name: 'United States', type: 'country', country_code: 'US' },
  { key: 'BR', name: 'Brazil', type: 'country', country_code: 'BR' },
];

const LANGUAGES = [
  { code: 'es', name: 'Spanish' },
  { code: 'en', name: 'English' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'it', name: 'Italian' },
  { code: 'ja', name: 'Japanese' },
  { code: 'ko', name: 'Korean' },
  { code: 'zh', name: 'Chinese' },
];

// Film genres for audience targeting (English label → Spanish API value)
const FILM_GENRES: { label: string; value: string }[] = [
  { label: 'Drama', value: 'Drama' },
  { label: 'Comedy', value: 'Comedia' },
  { label: 'Action', value: 'Acción' },
  { label: 'Horror', value: 'Terror' },
  { label: 'Thriller', value: 'Suspenso' },
  { label: 'Romance', value: 'Romance' },
  { label: 'Sci-Fi', value: 'Ciencia Ficción' },
  { label: 'Documentary', value: 'Documental' },
  { label: 'Animation', value: 'Animación' },
  { label: 'Adventure', value: 'Aventura' },
  { label: 'Fantasy', value: 'Fantasía' },
  { label: 'Musical', value: 'Musical' },
  { label: 'Crime', value: 'Crimen' },
  { label: 'Biography', value: 'Biografía' },
  { label: 'History', value: 'Historia' },
  { label: 'War', value: 'Guerra' },
  { label: 'Western', value: 'Western' },
  { label: 'Family', value: 'Familia' },
  { label: 'Sports', value: 'Deportes' },
  { label: 'Mystery', value: 'Misterio' },
];

// Meta ad preview format type
type MetaAdPreviewFormat =
  | 'DESKTOP_FEED_STANDARD'
  | 'MOBILE_FEED_STANDARD'
  | 'INSTAGRAM_STANDARD'
  | 'INSTAGRAM_STORY';

/**
 * Maps platform and ad style to Meta's preview format
 */
function getMetaFormat(platform: string, style: string): MetaAdPreviewFormat {
  if (platform === 'facebook') {
    if (style === 'Feed') return 'MOBILE_FEED_STANDARD';
    if (style === 'Stories') return 'MOBILE_FEED_STANDARD';
    if (style === 'Reels') return 'MOBILE_FEED_STANDARD';
  }
  if (platform === 'instagram') {
    if (style === 'Feed') return 'INSTAGRAM_STANDARD';
    if (style === 'Stories') return 'INSTAGRAM_STORY';
    if (style === 'Reels') return 'INSTAGRAM_STANDARD';
  }
  return 'MOBILE_FEED_STANDARD';
}

export default function CreateCampaignClient({ film, localImages, localVideos }: CreateCampaignClientProps) {
  // Tab states
  const [leftTab, setLeftTab] = useState(0);
  const [rightTab, setRightTab] = useState(0);

  // Platform and ad style
  const [selectedAdStyle, setSelectedAdStyle] = useState('Feed');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['facebook']);

  // Form state - Demographics & Budget
  const [ageMin, setAgeMin] = useState(18);
  const [ageMax, setAgeMax] = useState(65);
  const [gender, setGender] = useState('ALL');
  const [selectedLocations, setSelectedLocations] = useState<MetaLocation[]>([DEFAULT_COUNTRIES[0]]);
  const [locationOptions, setLocationOptions] = useState<MetaLocation[]>(DEFAULT_COUNTRIES);
  const [locationSearch, setLocationSearch] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  const [budget, setBudget] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [usePijamaAudience, setUsePijamaAudience] = useState(true);
  const [showAudienceWarning, setShowAudienceWarning] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(film.genre || []);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const router = useRouter();

  // Form state - Copies (single language, generated via API)
  const [selectedLanguage, setSelectedLanguage] = useState('es');
  const [loadingLanguage, setLoadingLanguage] = useState<string | null>(null);
  const [copies, setCopies] = useState<Record<string, { headline: string; description: string }>>({});

  // Form state - Media Assets (start with all local DB assets selected)
  const [selectedAssets, setSelectedAssets] = useState<string[]>(() => [
    ...localImages.map((asset) => asset.id),
    ...localVideos.map((asset) => asset.id),
  ]);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerAsset, setViewerAsset] = useState<LocalAsset | UploadedAsset | null>(null);

  // Uploaded assets (newly uploaded during this session)
  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Preview state
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Preview navigation state
  const [previewAssetIndex, setPreviewAssetIndex] = useState(0);
  const [previewVariant, setPreviewVariant] = useState<'A' | 'B' | 'C'>('A');

  // Budget amount for validation
  const budgetAmount = Number(budget) || 0;

  // Compute merged assets (local DB assets + newly uploaded)
  const allVideos = useMemo(
    () => [...localVideos, ...uploadedAssets.filter((a) => a.type === 'video')],
    [localVideos, uploadedAssets]
  );

  const allImages = useMemo(
    () => [...localImages, ...uploadedAssets.filter((a) => a.type === 'image')],
    [localImages, uploadedAssets]
  );

  // Get selected media assets by type (memoized to prevent infinite loops in useCallback/useEffect)
  const selectedVideos = useMemo(() =>
    allVideos.filter(asset => selectedAssets.includes(asset.id)),
    [allVideos, selectedAssets]
  );
  const selectedImages = useMemo(() =>
    allImages.filter(asset => selectedAssets.includes(asset.id)),
    [allImages, selectedAssets]
  );

  // Assets available for preview (prioritize videos with metaVideoId)
  const previewableAssets = useMemo(() => {
    const videoWithMeta = selectedVideos.filter(v => v.metaVideoId);
    return [...videoWithMeta, ...selectedImages, ...selectedVideos.filter(v => !v.metaVideoId)];
  }, [selectedVideos, selectedImages]);

  // Available variants for current language
  const availableVariants = useMemo(() => {
    return (['A', 'B', 'C'] as const).filter(v => copies[v]?.headline);
  }, [copies]);

  // Fetch preview from Meta API
  const fetchPreview = useCallback(async () => {
    // Get media asset at current preview index
    const mediaAsset = previewableAssets[previewAssetIndex];
    if (!mediaAsset) {
      setPreviewHtml(null);
      setPreviewError(null);
      return;
    }

    // Get copy for preview using current variant
    const copy = copies[previewVariant];
    if (!copy?.headline) {
      setPreviewHtml(null);
      setPreviewError(null);
      return;
    }

    const currentPlatform = PLATFORMS[rightTab];
    const format = getMetaFormat(currentPlatform.id, selectedAdStyle);

    // For videos, we need metaVideoId for preview
    const isVideo = mediaAsset.type === 'video';
    const metaVideoId = isVideo ? (mediaAsset as LocalAsset).metaVideoId : undefined;

    setPreviewLoading(true);
    setPreviewError(null);

    try {
      const response = await fetch('/api/meta/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          headline: copy.headline,
          description: copy.description,
          primaryText: copy.description || copy.headline,
          linkUrl: film.trailerUrl || 'https://pijama.film',
          mediaUrl: mediaAsset.url,
          mediaType: isVideo ? 'VIDEO' : 'IMAGE',
          metaVideoId: metaVideoId || undefined,
          thumbnailUrl: isVideo ? mediaAsset.thumbnailUrl : undefined,
          format,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        // If video not ready, show a friendly message
        if (error.code === 'VIDEO_NOT_READY') {
          setPreviewError('El video aún se está procesando. La vista previa estará disponible pronto.');
        } else {
          throw new Error(error.details || error.error || 'Error al generar vista previa');
        }
        setPreviewHtml(null);
        return;
      }

      const data = await response.json();
      setPreviewHtml(data.preview);
    } catch (error) {
      console.error('Error fetching preview:', error);
      setPreviewError(error instanceof Error ? error.message : 'Error desconocido');
      setPreviewHtml(null);
    } finally {
      setPreviewLoading(false);
    }
  }, [rightTab, selectedAdStyle, previewableAssets, previewAssetIndex, copies, previewVariant, film.trailerUrl]);

  // SSE listener for background asset sync notifications
  useEffect(() => {
    const eventSource = new EventSource(`/api/events?filmId=${film.id}`);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'image_ready') {
          // Add new image to uploaded assets if not already present
          setUploadedAssets((prev) => {
            if (prev.some((a) => a.id === data.imageId)) return prev;
            return [
              ...prev,
              {
                id: data.imageId,
                type: 'image' as const,
                name: data.name,
                url: data.url,
                thumbnailUrl: data.url,
                storageKey: '', // Not needed for display
              },
            ];
          });
          // Auto-select the new asset
          setSelectedAssets((prev) => {
            if (prev.includes(data.imageId)) return prev;
            return [...prev, data.imageId];
          });
        }

        if (data.type === 'video_synced') {
          // Add new video to uploaded assets if not already present
          setUploadedAssets((prev) => {
            if (prev.some((a) => a.id === data.videoId)) return prev;
            return [
              ...prev,
              {
                id: data.videoId,
                type: 'video' as const,
                name: data.name,
                url: data.url,
                thumbnailUrl: data.thumbnailUrl || data.url,
                storageKey: '', // Not needed for display
              },
            ];
          });
          // Auto-select the new asset
          setSelectedAssets((prev) => {
            if (prev.includes(data.videoId)) return prev;
            return [...prev, data.videoId];
          });
        }

        if (data.type === 'video_ready') {
          // Video was uploaded to Meta - update metaVideoId
          console.log(`[SSE] Video ${data.videoId} ready with Meta ID: ${data.metaVideoId}`);
          setUploadedAssets((prev) =>
            prev.map((a) =>
              a.id === data.videoId ? { ...a, metaVideoId: data.metaVideoId } : a
            )
          );
        }

        if (data.type === 'asset_sync_complete') {
          console.log(`[SSE] Asset sync complete: ${data.imagesCount} images, ${data.videosCount} videos`);
        }
      } catch (error) {
        console.error('[SSE] Error parsing event:', error);
      }
    };

    eventSource.onerror = () => {
      // SSE will auto-reconnect, just log
      console.log('[SSE] Connection error, will retry...');
    };

    return () => {
      eventSource.close();
    };
  }, [film.id]);

  // Auto-fetch preview when relevant data changes
  useEffect(() => {
    // Only fetch if we have selected media and copy for current variant
    if (previewableAssets.length > 0 && copies[previewVariant]?.headline) {
      // Debounce the fetch to avoid too many API calls
      const timeoutId = setTimeout(fetchPreview, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [fetchPreview, previewableAssets.length, copies, previewVariant]);

  // Reset preview asset index when selected assets change
  useEffect(() => {
    setPreviewAssetIndex(0);
  }, [selectedAssets]);

  // Reset preview variant when language changes or variant becomes unavailable
  useEffect(() => {
    if (availableVariants.length > 0 && !availableVariants.includes(previewVariant)) {
      setPreviewVariant(availableVariants[0]);
    }
  }, [availableVariants, previewVariant]);

  // Keyboard navigation for preview
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setPreviewAssetIndex((prev) => {
            if (previewableAssets.length === 0) return 0;
            return prev === 0 ? previewableAssets.length - 1 : prev - 1;
          });
          break;
        case 'ArrowRight':
          e.preventDefault();
          setPreviewAssetIndex((prev) => {
            if (previewableAssets.length === 0) return 0;
            return prev === previewableAssets.length - 1 ? 0 : prev + 1;
          });
          break;
        case 'ArrowUp':
          e.preventDefault();
          setPreviewVariant((prev) => {
            if (availableVariants.length === 0) return prev;
            const currentIdx = availableVariants.indexOf(prev);
            const newIdx = currentIdx === 0 ? availableVariants.length - 1 : currentIdx - 1;
            return availableVariants[newIdx];
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setPreviewVariant((prev) => {
            if (availableVariants.length === 0) return prev;
            const currentIdx = availableVariants.indexOf(prev);
            const newIdx = currentIdx === availableVariants.length - 1 ? 0 : currentIdx + 1;
            return availableVariants[newIdx];
          });
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [previewableAssets.length, availableVariants]);

  // Debounced location search
  useEffect(() => {
    if (!locationSearch.trim()) {
      setLocationOptions(DEFAULT_COUNTRIES);
      return;
    }

    setLocationLoading(true);
    const timeoutId = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/meta/locations?q=${encodeURIComponent(locationSearch)}&types=country&limit=20`
        );
        if (response.ok) {
          const data = await response.json();
          setLocationOptions(data.data || []);
        } else {
          // Fallback to filtering defaults
          setLocationOptions(
            DEFAULT_COUNTRIES.filter(
              (c) =>
                c.name.toLowerCase().includes(locationSearch.toLowerCase()) ||
                c.country_code?.toLowerCase() === locationSearch.toLowerCase()
            )
          );
        }
      } catch {
        // Fallback to filtering defaults on error
        setLocationOptions(
          DEFAULT_COUNTRIES.filter(
            (c) =>
              c.name.toLowerCase().includes(locationSearch.toLowerCase()) ||
              c.country_code?.toLowerCase() === locationSearch.toLowerCase()
          )
        );
      } finally {
        setLocationLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [locationSearch]);

  const handleCopyChange = (variant: 'A' | 'B' | 'C', field: string, value: string) => {
    setCopies(prev => ({
      ...prev,
      [variant]: { ...prev[variant], [field]: value },
    }));
  };

  const handleLanguageChange = async (langCode: string) => {
    setSelectedLanguage(langCode);
    setLoadingLanguage(langCode);

    const emptyCopies = {
      A: { headline: '', description: '' },
      B: { headline: '', description: '' },
      C: { headline: '', description: '' },
    };

    try {
      const response = await fetch('/api/copies/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filmId: film.id, languages: [langCode] }),
      });

      if (!response.ok) {
        throw new Error('Failed to generate copies');
      }

      const { copies: generatedCopies } = await response.json();
      const langCopies = generatedCopies[langCode];

      // Transform API response to UI format
      const formattedCopies = langCopies?.reduce(
        (acc: Record<string, { headline: string; description: string }>, copy: { headline: string; primaryText: string; variant: string }) => ({
          ...acc,
          [copy.variant]: { headline: copy.headline, description: copy.primaryText },
        }),
        {}
      ) || emptyCopies;

      setCopies(formattedCopies);
    } catch (error) {
      console.error('Error generating copies:', error);
      // Fallback to empty copies on error
      setCopies(emptyCopies);
    }

    setLoadingLanguage(null);
  };

  const handleDeleteVariant = (variant: 'A' | 'B' | 'C') => {
    setCopies(prev => {
      const newCopies = { ...prev };
      delete newCopies[variant];
      return newCopies;
    });
  };

  const handleAddVariant = (variant: 'A' | 'B' | 'C') => {
    setCopies(prev => ({
      ...prev,
      [variant]: { headline: '', description: '' },
    }));
  };

  const getAvailableVariants = () => {
    const existingVariants = Object.keys(copies);
    return (['A', 'B', 'C'] as const).filter(v => !existingVariants.includes(v));
  };

  const handleFileUpload = async (files: FileList) => {
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

        const newAsset: UploadedAsset = {
          id: result.id,
          type: isVideo ? 'video' : 'image',
          name: result.name || file.name,
          url: result.url,
          thumbnailUrl: result.thumbnailUrl || result.url,
          storageKey: result.storageKey,
          metaVideoId: result.metaVideoId,
        };

        setUploadedAssets(prev => [...prev, newAsset]);
        setSelectedAssets(prev => [...prev, newAsset.id]);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      }
    }
    setUploading(false);
  };

  const currentPlatform = PLATFORMS[rightTab];

  // Map gender string to Meta API number array
  const mapGender = (genderValue: string): number[] => {
    switch (genderValue) {
      case 'MALE': return [1];
      case 'FEMALE': return [2];
      case 'ALL':
      default: return [];
    }
  };

  // Map form state to API schema including ads
  const mapFormToAPI = () => {
    // Get headlines and bodies from all variants
    const headlines = Object.values(copies)
      .map(v => v.headline)
      .filter(Boolean);
    const bodies = Object.values(copies)
      .map(v => v.description)
      .filter(Boolean);

    // Get selected image and video IDs
    const imageIds = selectedAssets.filter(id =>
      allImages.some(img => img.id === id)
    );
    const videoIds = selectedAssets.filter(id =>
      allVideos.some(vid => vid.id === id)
    );

    // Create single ad with all copy variants
    const ad = {
      name: `${film.title} - ${selectedLanguage.toUpperCase()}`,
      language: selectedLanguage,
      headlines: headlines.length > 0 ? headlines : [`Descubre ${film.title}`],
      bodies: bodies.length > 0 ? bodies : [film.description || `Una película que no te puedes perder`],
      descriptions: [],
      callToAction: 'LEARN_MORE',
      linkUrl: film.trailerUrl || `https://pijama.film/films/${film.id}`,
      imageIds,
      videoIds,
    };

    return {
      name: `${film.title} - Campaign`,
      objective: 'LANDING_PAGE_VIEW' as const,
      language: selectedLanguage,
      budget: Number(budget),
      budgetType: 'LIFETIME' as const,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      targetCountries: selectedLocations.map((loc) => loc.country_code || loc.key),
      targetAgeMin: ageMin,
      targetAgeMax: ageMax,
      targetGenders: mapGender(gender),
      includeBaseAudiences: usePijamaAudience,
      filmGenres: selectedGenres,
      includeLgbtAudience: gender === 'LGBTQ',
      filmMuviUuid: film.id,
      ads: [ad],
      autoSync: true,
    };
  };

  // Submit campaign with ads to API and auto-sync to Meta
  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const payload = mapFormToAPI();

      // Validate we have at least one ad with media
      const hasMedia = payload.ads.some(ad => ad.imageIds.length > 0 || ad.videoIds.length > 0);
      if (!hasMedia) {
        throw new Error('Selecciona al menos una imagen o video para tu campaña');
      }

      const response = await fetch('/api/meta/campaigns/create-and-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || error.details?.fieldErrors?.toString() || 'Error al crear la campaña');
      }

      const result = await response.json();

      // Check for partial success (campaign created but sync failed)
      if (result.syncError) {
        console.warn('Campaign created but sync failed:', result.syncError);
      }

      // Check for ad sync errors
      if (result.adErrors?.length > 0) {
        console.warn('Some ads failed to sync:', result.adErrors);
      }

      router.push(`/films/${film.id}/campaigns/${result.campaign.id}`);
    } catch (error) {
      console.error('Error creating campaign:', error);
      setSubmitError(error instanceof Error ? error.message : 'Error al crear la campaña');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="h3" component="h1" gutterBottom>
          Create Campaign
        </Typography>
        <Typography variant="h5" color="text.secondary">
          {film.title}
        </Typography>
      </Box>

      {/* Two Column Layout */}
      <Grid container spacing={4}>
        {/* Left Column - Input Tabs */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper sx={{ p: 3 }}>
            <Tabs value={leftTab} onChange={(e, v) => setLeftTab(v)} sx={{ mb: 3 }}>
              <Tab label="Schedule" />
              <Tab label="Ad Copy" />
              <Tab label="Media" />
            </Tabs>

            {/* Tab 1: Programming */}
            {leftTab === 0 && (
              <Box>
                <Grid container spacing={3}>
                  <Grid size={{ xs: 12 }}>
                    <FormControl component="fieldset">
                      <Typography variant="subtitle2" gutterBottom>
                        Platforms
                      </Typography>
                      <FormGroup row>
                        {PLATFORMS.map((platform) => (
                          <FormControlLabel
                            key={platform.id}
                            control={
                              <Checkbox
                                checked={selectedPlatforms.includes(platform.id)}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedPlatforms([...selectedPlatforms, platform.id]);
                                  } else {
                                    setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform.id));
                                  }
                                }}
                              />
                            }
                            label={platform.name}
                          />
                        ))}
                      </FormGroup>
                    </FormControl>
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Min Age"
                      type="number"
                      value={ageMin}
                      onChange={(e) => setAgeMin(Number(e.target.value))}
                      inputProps={{ min: 13, max: 100 }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Max Age"
                      type="number"
                      value={ageMax}
                      onChange={(e) => setAgeMax(Number(e.target.value))}
                      inputProps={{ min: 13, max: 100 }}
                    />
                  </Grid>

                  <Grid size={{ xs: 12 }}>
                    <FormControl component="fieldset">
                      <Typography variant="subtitle2" gutterBottom>
                        Gender
                      </Typography>
                      <RadioGroup
                        row
                        value={gender}
                        onChange={(e) => setGender(e.target.value)}
                      >
                        <FormControlLabel value="ALL" control={<Radio />} label="All" />
                        <FormControlLabel value="MALE" control={<Radio />} label="Male" />
                        <FormControlLabel value="FEMALE" control={<Radio />} label="Female" />
                        <FormControlLabel value="LGBTQ" control={<Radio />} label="LGBTQ+" />
                      </RadioGroup>
                    </FormControl>
                  </Grid>

                  <Grid size={{ xs: 12 }}>
                    <Autocomplete
                      multiple
                      options={locationOptions}
                      getOptionLabel={(option) => option.name}
                      value={selectedLocations}
                      onChange={(_, newValue) => setSelectedLocations(newValue)}
                      onInputChange={(_, value) => setLocationSearch(value)}
                      loading={locationLoading}
                      filterOptions={(x) => x}
                      isOptionEqualToValue={(option, value) =>
                        option.key === value.key || option.country_code === value.country_code
                      }
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Countries"
                          placeholder="Search countries..."
                          InputProps={{
                            ...params.InputProps,
                            endAdornment: (
                              <>
                                {locationLoading ? <CircularProgress color="inherit" size={20} /> : null}
                                {params.InputProps.endAdornment}
                              </>
                            ),
                          }}
                        />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => {
                          const { key, ...tagProps } = getTagProps({ index });
                          return <Chip key={key} label={option.name} {...tagProps} />;
                        })
                      }
                      renderOption={(props, option) => (
                        <li {...props} key={option.key}>
                          {option.name}
                          {option.country_code && option.country_code !== option.name && (
                            <Typography
                              component="span"
                              variant="body2"
                              color="text.secondary"
                              sx={{ ml: 1 }}
                            >
                              ({option.country_code})
                            </Typography>
                          )}
                        </li>
                      )}
                    />
                  </Grid>

                  <Grid size={{ xs: 12 }}>
                    <TextField
                      fullWidth
                      label="Budget ($)"
                      type="number"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                      inputProps={{ min: 0, step: 100 }}
                    />
                  </Grid>

                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="Start Date"
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      InputLabelProps={{ shrink: true }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      fullWidth
                      label="End Date"
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      InputLabelProps={{ shrink: true }}
                      required
                    />
                  </Grid>

                  <Grid size={{ xs: 12 }}>
                    <Paper
                      elevation={usePijamaAudience ? 4 : 1}
                      sx={{
                        p: 2,
                        border: '2px solid',
                        borderColor: usePijamaAudience ? 'primary.main' : 'divider',
                        bgcolor: usePijamaAudience ? 'rgba(255, 191, 0, 0.1)' : 'background.paper',
                        transition: 'all 0.2s ease-in-out',
                      }}
                    >
                      <FormControlLabel
                        control={
                          <Checkbox
                            checked={usePijamaAudience}
                            onChange={(e) => {
                              if (!e.target.checked) {
                                setShowAudienceWarning(true);
                              } else {
                                setUsePijamaAudience(true);
                              }
                            }}
                            sx={{ '& .MuiSvgIcon-root': { fontSize: 28 } }}
                          />
                        }
                        label={
                          <Box>
                            <Typography variant="subtitle1" component="span" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                              Use Pijama Audience
                            </Typography>
                            <Typography variant="body2" display="block" color="text.secondary">
                              Optimize your campaign with our specialized film audience
                            </Typography>
                          </Box>
                        }
                      />
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12 }}>
                    <Autocomplete
                      multiple
                      options={FILM_GENRES}
                      getOptionLabel={(option) => option.label}
                      value={FILM_GENRES.filter(g => selectedGenres.includes(g.value))}
                      onChange={(e, newValue) => setSelectedGenres(newValue.map(v => v.value))}
                      isOptionEqualToValue={(option, value) => option.value === value.value}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Genre Targeting"
                          placeholder="Select genres"
                          helperText="Target audiences interested in these film genres"
                        />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => {
                          const { key, ...tagProps } = getTagProps({ index });
                          return <Chip key={key} label={option.label} {...tagProps} />;
                        })
                      }
                    />
                  </Grid>

                </Grid>
              </Box>
            )}

            {/* Tab 2: Creatives */}
            {leftTab === 1 && (
              <Box>
                <FormControl fullWidth sx={{ mb: 3 }}>
                  <InputLabel>Language</InputLabel>
                  <Select
                    value={selectedLanguage}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    label="Language"
                    disabled={loadingLanguage !== null}
                  >
                    {LANGUAGES.map(lang => (
                      <MenuItem key={lang.code} value={lang.code}>
                        {lang.name}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                {loadingLanguage === selectedLanguage ? (
                  <Box sx={{ textAlign: 'center', py: 4 }}>
                    <Typography color="text.secondary">
                      Generating texts with AI...
                    </Typography>
                  </Box>
                ) : (
                  <>
                    {(['A', 'B', 'C'] as const).map((variant) => {
                      // Only render if this variant exists
                      if (!copies[variant]) return null;

                      const existingVariants = Object.keys(copies);
                      const isLastVariant = existingVariants.indexOf(variant) === existingVariants.length - 1;

                      return (
                        <Box key={variant} sx={{ mb: 3 }}>
                          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                            <Typography variant="h6">
                              Variant {variant}
                            </Typography>
                            <IconButton
                              size="small"
                              onClick={() => handleDeleteVariant(variant)}
                              color="error"
                            >
                              <DeleteIcon fontSize="small" />
                            </IconButton>
                          </Box>
                          <Grid container spacing={2}>
                            <Grid size={{ xs: 12 }}>
                              <TextField
                                fullWidth
                                label="Title"
                                value={copies[variant]?.headline || ''}
                                onChange={(e) => handleCopyChange(variant, 'headline', e.target.value)}
                                inputProps={{ maxLength: 100 }}
                                helperText={`${(copies[variant]?.headline || '').length}/100`}
                              />
                            </Grid>
                            <Grid size={{ xs: 12 }}>
                              <TextField
                                fullWidth
                                label="Description"
                                multiline
                                rows={3}
                                value={copies[variant]?.description || ''}
                                onChange={(e) => handleCopyChange(variant, 'description', e.target.value)}
                                inputProps={{ maxLength: 500 }}
                                helperText={`${(copies[variant]?.description || '').length}/500`}
                              />
                            </Grid>
                          </Grid>
                          {!isLastVariant && <Divider sx={{ mt: 3 }} />}
                        </Box>
                      );
                    })}
                    {Object.keys(copies).length === 0 && (
                      <Box sx={{ textAlign: 'center', py: 4 }}>
                        <Typography color="text.secondary">
                          No variants. All have been deleted.
                        </Typography>
                      </Box>
                    )}
                    {getAvailableVariants().length > 0 && (
                      <Box sx={{ mt: 2 }}>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => handleAddVariant(getAvailableVariants()[0])}
                        >
                          + New Variant
                        </Button>
                      </Box>
                    )}
                  </>
                )}
              </Box>
            )}

            {/* Tab 3: Media Assets */}
            {leftTab === 2 && (
              <Box>
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
                  onClick={() => document.getElementById('file-upload')?.click()}
                >
                  <input
                    id="file-upload"
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

                <Typography variant="h6" gutterBottom>
                  Videos
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                  {allVideos.map((asset) => (
                    <Card
                      key={asset.id}
                      sx={{
                        width: 120,
                        position: 'relative',
                        border: selectedAssets.includes(asset.id) ? '2px solid' : '1px solid',
                        borderColor: selectedAssets.includes(asset.id) ? 'primary.main' : 'divider',
                      }}
                    >
                      <Box sx={{ position: 'absolute', top: 2, left: 2, zIndex: 1 }}>
                        <Checkbox
                          size="small"
                          checked={selectedAssets.includes(asset.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAssets([...selectedAssets, asset.id]);
                            } else {
                              setSelectedAssets(selectedAssets.filter(id => id !== asset.id));
                            }
                          }}
                          sx={{
                            bgcolor: 'rgba(255,255,255,0.8)',
                            borderRadius: 1,
                            p: 0.25,
                            '&:hover': { bgcolor: 'rgba(255,255,255,0.9)' }
                          }}
                        />
                      </Box>
                      {uploadedAssets.some(a => a.id === asset.id) && (
                        <Chip
                          label="New"
                          size="small"
                          color="primary"
                          sx={{ position: 'absolute', top: 2, right: 2, fontSize: '0.6rem', height: 18, zIndex: 1 }}
                        />
                      )}
                      <CardMedia
                        component="img"
                        height="75"
                        image={asset.thumbnailUrl}
                        alt={asset.name}
                        onClick={() => {
                          setViewerAsset(asset);
                          setViewerOpen(true);
                        }}
                        sx={{ cursor: 'pointer' }}
                      />
                      <CardContent sx={{ p: 0.5 }}>
                        <Typography variant="caption" noWrap sx={{ fontSize: '0.7rem' }}>{asset.name}</Typography>
                      </CardContent>
                    </Card>
                  ))}
                </Box>

                <Typography variant="h6" gutterBottom>
                  Images
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {allImages.map((asset) => (
                    <Card
                      key={asset.id}
                      sx={{
                        width: 120,
                        position: 'relative',
                        border: selectedAssets.includes(asset.id) ? '2px solid' : '1px solid',
                        borderColor: selectedAssets.includes(asset.id) ? 'primary.main' : 'divider',
                      }}
                    >
                      <Box sx={{ position: 'absolute', top: 2, left: 2, zIndex: 1 }}>
                        <Checkbox
                          size="small"
                          checked={selectedAssets.includes(asset.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedAssets([...selectedAssets, asset.id]);
                            } else {
                              setSelectedAssets(selectedAssets.filter(id => id !== asset.id));
                            }
                          }}
                          sx={{
                            bgcolor: 'rgba(255,255,255,0.8)',
                            borderRadius: 1,
                            p: 0.25,
                            '&:hover': { bgcolor: 'rgba(255,255,255,0.9)' }
                          }}
                        />
                      </Box>
                      {uploadedAssets.some(a => a.id === asset.id) && (
                        <Chip
                          label="New"
                          size="small"
                          color="primary"
                          sx={{ position: 'absolute', top: 2, right: 2, fontSize: '0.6rem', height: 18, zIndex: 1 }}
                        />
                      )}
                      <CardMedia
                        component="img"
                        height="75"
                        image={asset.thumbnailUrl}
                        alt={asset.name}
                        onClick={() => {
                          setViewerAsset(asset);
                          setViewerOpen(true);
                        }}
                        sx={{ cursor: 'pointer' }}
                      />
                      <CardContent sx={{ p: 0.5 }}>
                        <Typography variant="caption" noWrap sx={{ fontSize: '0.7rem' }}>{asset.name}</Typography>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              </Box>
            )}

            {/* Error Display */}
            {submitError && (
              <Alert severity="error" sx={{ mt: 3 }} onClose={() => setSubmitError(null)}>
                {submitError}
              </Alert>
            )}

            {/* Action Buttons */}
            <Box sx={{ mt: 4, display: 'flex', gap: 2, justifyContent: 'space-between' }}>
              <Box>
                {leftTab > 0 && (
                  <Button variant="outlined" onClick={() => setLeftTab(leftTab - 1)}>
                    Back
                  </Button>
                )}
              </Box>
              <Box sx={{ display: 'flex', gap: 2 }}>
                <Button variant="outlined">
                  Save Draft
                </Button>
                {leftTab < 2 ? (
                  <Button variant="contained" size="large" onClick={() => setLeftTab(leftTab + 1)}>
                    Next
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    size="large"
                    disabled={budgetAmount === 0 || !startDate || submitting}
                    onClick={handleSubmit}
                  >
                    {submitting ? <CircularProgress size={24} color="inherit" /> : 'Promote'}
                  </Button>
                )}
              </Box>
            </Box>
          </Paper>
        </Grid>

        {/* Right Column - Ad Preview with Platform Tabs */}
        <Grid size={{ xs: 12, md: 5 }}>
          <Paper sx={{ p: 3, position: 'sticky', top: 20 }}>
            <Typography variant="h6" gutterBottom>
              Ad Preview
            </Typography>

            {/* Platform Tabs */}
            <Tabs value={rightTab} onChange={(e, v) => setRightTab(v)} sx={{ mb: 2 }}>
              <Tab label="Facebook" />
              <Tab label="Instagram" />
            </Tabs>

            {/* Ad Style Selector for Current Platform */}
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" gutterBottom>
                Ad Style
              </Typography>
              <ToggleButtonGroup
                value={selectedAdStyle}
                exclusive
                onChange={(e, value) => value && setSelectedAdStyle(value)}
                size="small"
                fullWidth
              >
                {currentPlatform.adStyles.map(style => (
                  <ToggleButton key={style} value={style}>
                    {style}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Box>

            {/* Preview Navigation Controls */}
            {(previewableAssets.length > 1 || availableVariants.length > 1) && (
              <Box sx={{ mb: 2, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
                {previewableAssets.length > 1 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <IconButton
                      size="small"
                      onClick={() => setPreviewAssetIndex((prev) =>
                        prev === 0 ? previewableAssets.length - 1 : prev - 1
                      )}
                    >
                      <ChevronLeftIcon fontSize="small" />
                    </IconButton>
                    <Typography variant="caption" color="text.secondary">
                      {previewAssetIndex + 1}/{previewableAssets.length}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => setPreviewAssetIndex((prev) =>
                        prev === previewableAssets.length - 1 ? 0 : prev + 1
                      )}
                    >
                      <ChevronRightIcon fontSize="small" />
                    </IconButton>
                  </Box>
                )}
                {availableVariants.length > 1 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <IconButton
                      size="small"
                      onClick={() => setPreviewVariant((prev) => {
                        const currentIdx = availableVariants.indexOf(prev);
                        const newIdx = currentIdx === 0 ? availableVariants.length - 1 : currentIdx - 1;
                        return availableVariants[newIdx];
                      })}
                    >
                      <KeyboardArrowUpIcon fontSize="small" />
                    </IconButton>
                    <Typography variant="caption" color="text.secondary">
                      {previewVariant}
                    </Typography>
                    <IconButton
                      size="small"
                      onClick={() => setPreviewVariant((prev) => {
                        const currentIdx = availableVariants.indexOf(prev);
                        const newIdx = currentIdx === availableVariants.length - 1 ? 0 : currentIdx + 1;
                        return availableVariants[newIdx];
                      })}
                    >
                      <KeyboardArrowDownIcon fontSize="small" />
                    </IconButton>
                  </Box>
                )}
              </Box>
            )}

            {/* Ad Preview Content */}
            <Box sx={{ minHeight: 400, display: 'flex', flexDirection: 'column' }}>
              {previewLoading ? (
                <Box
                  sx={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: 2,
                    bgcolor: 'background.default',
                    border: '1px solid',
                    borderColor: 'divider',
                    borderRadius: 1,
                  }}
                >
                  <CircularProgress />
                  <Typography color="text.secondary">
                    Generando vista previa...
                  </Typography>
                </Box>
              ) : previewError ? (
                <Box
                  sx={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexDirection: 'column',
                    gap: 2,
                    bgcolor: 'background.default',
                    border: '1px solid',
                    borderColor: 'error.main',
                    borderRadius: 1,
                    p: 3,
                  }}
                >
                  <Typography color="error" align="center">
                    {previewError}
                  </Typography>
                  <Button variant="outlined" size="small" onClick={fetchPreview}>
                    Reintentar
                  </Button>
                </Box>
              ) : previewHtml ? (
                <Box
                  sx={{
                    flex: 1,
                    display: 'flex',
                    justifyContent: 'center',
                    '& iframe': {
                      border: 'none',
                      maxWidth: '100%',
                    },
                  }}
                  dangerouslySetInnerHTML={{
                    __html: previewHtml
                      .replace(/&amp;/g, '&')
                      .replace(/&lt;/g, '<')
                      .replace(/&gt;/g, '>')
                      .replace(/&quot;/g, '"'),
                  }}
                />
              ) : (
                <Card sx={{ bgcolor: 'background.default', border: '1px solid', borderColor: 'divider' }}>
                  <CardMedia
                    component="img"
                    height="300"
                    image={film.posterUrl || 'https://picsum.photos/seed/preview/400/300'}
                    alt={film.title}
                    sx={{ objectFit: 'cover' }}
                  />
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                      <Chip
                        label={currentPlatform.name}
                        size="small"
                        color="primary"
                      />
                      <Chip
                        label={selectedAdStyle}
                        size="small"
                        variant="outlined"
                      />
                    </Box>
                    <Typography variant="h6" gutterBottom>
                      {copies[previewVariant]?.headline || 'Título del anuncio'}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {copies[previewVariant]?.description || 'Selecciona un medio y agrega texto para ver la vista previa'}
                    </Typography>
                  </CardContent>
                </Card>
              )}
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              {previewHtml
                ? 'Vista previa generada por Meta. La apariencia final puede variar.'
                : 'Vista previa aproximada. La apariencia final puede variar por plataforma.'}
            </Typography>
          </Paper>
        </Grid>
      </Grid>

      {/* Warning Modal for Audience Opt-out */}
      <Dialog
        open={showAudienceWarning}
        onClose={() => setShowAudienceWarning(false)}
      >
        <DialogTitle>Confirmation</DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you don't want to use an optimized audience?
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setShowAudienceWarning(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              setUsePijamaAudience(false);
              setShowAudienceWarning(false);
            }}
            variant="contained"
            color="error"
          >
            Confirm
          </Button>
        </DialogActions>
      </Dialog>

      {/* Media Viewer Dialog */}
      <Dialog
        open={viewerOpen}
        onClose={() => {
          setViewerOpen(false);
          setViewerAsset(null);
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          {viewerAsset?.name}
          <IconButton
            onClick={() => {
              setViewerOpen(false);
              setViewerAsset(null);
            }}
          >
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0 }}>
          {viewerAsset?.type === 'image' ? (
            <Box
              component="img"
              src={viewerAsset.url}
              alt={viewerAsset.name}
              sx={{
                width: '100%',
                height: 'auto',
                display: 'block',
              }}
            />
          ) : viewerAsset?.type === 'video' ? (
            <Box
              component="video"
              src={viewerAsset.url}
              controls
              autoPlay
              sx={{
                width: '100%',
                height: 'auto',
                display: 'block',
              }}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </Container>
  );
}
