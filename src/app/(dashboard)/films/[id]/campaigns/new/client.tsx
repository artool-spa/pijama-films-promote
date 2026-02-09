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
  Switch,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogContentText,
  DialogActions,
  IconButton,
  CircularProgress,
  LinearProgress,
  Alert,
  Tooltip,
} from '@mui/material';
import {
  Close as CloseIcon,
  Delete as DeleteIcon,
  CloudUpload as CloudUploadIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  KeyboardArrowUp as KeyboardArrowUpIcon,
  KeyboardArrowDown as KeyboardArrowDownIcon,
  Facebook as FacebookIcon,
  Instagram as InstagramIcon,
  YouTube as YouTubeIcon,
  Warning as WarningIcon,
  Refresh as RefreshIcon,
  Image as ImageIcon,
  TextFields as TextFieldsIcon,
  HourglassEmpty as HourglassIcon,
  HelpOutline as HelpIcon,
} from '@mui/icons-material';
import type { Film } from '@/models/film';
import YouTubeAdPreview from '@/components/YouTubeAdPreview';

// Asset status type
type AssetStatus = 'PENDING' | 'VALIDATING' | 'READY' | 'INVALID' | 'ERROR';

// Type for local database assets passed from server
type LocalAsset = {
  id: string;
  type: 'image' | 'video';
  name: string;
  url: string;
  thumbnailUrl: string;
  storageKey: string;
  metaVideoId?: string | null; // For videos uploaded to Meta
  // Validation fields
  status: AssetStatus;
  validationError?: string | null;
  aspectRatio?: string | null;
  facebookEligible: boolean;
  instagramEligible: boolean;
  eligibilityError?: string | null;
};

// Status labels and colors
const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  PENDING: 'Pending',
  VALIDATING: 'Validating...',
  READY: 'Ready',
  INVALID: 'Invalid',
  ERROR: 'Error',
};

const ASSET_STATUS_COLORS: Record<AssetStatus, 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  PENDING: 'default',
  VALIDATING: 'info',
  READY: 'success',
  INVALID: 'warning',
  ERROR: 'error',
};

// Custom styles for status chips (default color doesn't have fill)
const ASSET_STATUS_STYLES: Record<AssetStatus, object> = {
  PENDING: { bgcolor: 'grey.400', color: 'white' },
  VALIDATING: {},
  READY: {},
  INVALID: {},
  ERROR: {},
};

// Filter type for assets
type AssetFilter = 'all' | 'ready' | 'validating' | 'invalid';

type DraftFormState = {
  selectedPlatforms?: string[];
  selectedAdStyle?: string;
  ageMin?: number;
  ageMax?: number;
  gender?: string;
  selectedLocations?: MetaLocation[];
  budget?: string;
  startDate?: string;
  endDate?: string;
  usePijamaAudience?: boolean;
  selectedGenres?: string[];
  selectedLanguages?: string[];
  copiesByLang?: Record<string, Record<string, { headline: string; description: string }>>;
  selectedAssets?: string[];
  campaignName?: string;
};

type CreateCampaignClientProps = {
  film: Film;
  localImages: LocalAsset[];
  localVideos: LocalAsset[];
  initialBalance: number;
  existingDraft?: {
    id: string;
    draftFormState?: unknown;
    name: string;
    budget: number;
    startDate: Date;
    endDate: Date | null;
    targetCountries: string[];
    targetAgeMin: number;
    targetAgeMax: number;
    targetGenders: number[];
    includeBaseAudiences: boolean;
    filmGenres: string[];
    includeLgbtAudience: boolean;
    platforms: string[];
    language: string;
    filmMuviUuid: string;
  } | null;
  paymentStatus?: string;
  paymentSessionId?: string;
  howItWorksDismissed: boolean;
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
  // Validation fields
  status: AssetStatus;
  validationError?: string | null;
  aspectRatio?: string | null;
  facebookEligible: boolean;
  instagramEligible: boolean;
  eligibilityError?: string | null;
};

// Platform configurations with ad styles
const PLATFORMS = [
  { id: 'facebook', name: 'Facebook', adStyles: ['Feed', 'Stories'], platform: 'META' as const },
  { id: 'instagram', name: 'Instagram', adStyles: ['Feed', 'Stories'], platform: 'META' as const },
  { id: 'youtube', name: 'YouTube', adStyles: ['In-Stream', 'In-Feed', 'Bumper', 'Shorts'], platform: 'GOOGLE' as const },
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
  | 'FACEBOOK_STORY_MOBILE'
  | 'INSTAGRAM_STANDARD'
  | 'INSTAGRAM_STORY';

/**
 * Maps platform and ad style to Meta's preview format
 */
function getMetaFormat(platform: string, style: string): MetaAdPreviewFormat {
  if (platform === 'facebook') {
    if (style === 'Feed') return 'MOBILE_FEED_STANDARD';
    if (style === 'Stories') return 'FACEBOOK_STORY_MOBILE';
  }
  if (platform === 'instagram') {
    if (style === 'Feed') return 'INSTAGRAM_STANDARD';
    if (style === 'Stories') return 'INSTAGRAM_STORY';
  }
  return 'MOBILE_FEED_STANDARD';
}

function getYouTubeFormat(style: string): string {
  switch (style) {
    case 'In-Stream': return 'IN_STREAM_SKIPPABLE';
    case 'In-Feed': return 'IN_FEED';
    case 'Bumper': return 'BUMPER';
    case 'Shorts': return 'SHORTS';
    default: return 'IN_STREAM_SKIPPABLE';
  }
}

export default function CreateCampaignClient({ film, localImages, localVideos, initialBalance, existingDraft, paymentStatus, paymentSessionId, howItWorksDismissed }: CreateCampaignClientProps) {
  const todayStr = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // Parse draft form state if resuming
  const draft = existingDraft?.draftFormState as DraftFormState | undefined;

  // Draft ID tracking
  const [draftId, setDraftId] = useState<string | null>(existingDraft?.id ?? null);
  const [savingDraft, setSavingDraft] = useState(false);
  const defaultEndDate = (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  })();

  // Tab states
  const [leftTab, setLeftTab] = useState(0);
  const [rightTab, setRightTab] = useState(0);

  // Platform and ad style
  const [selectedAdStyle, setSelectedAdStyle] = useState(draft?.selectedAdStyle ?? 'Feed');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(draft?.selectedPlatforms ?? ['facebook', 'instagram']);

  // Form state - Demographics & Budget
  const [ageMin, setAgeMin] = useState(draft?.ageMin ?? existingDraft?.targetAgeMin ?? 18);
  const [ageMax, setAgeMax] = useState(draft?.ageMax ?? existingDraft?.targetAgeMax ?? 65);
  const [gender, setGender] = useState(draft?.gender ?? 'ALL');
  const [selectedLocations, setSelectedLocations] = useState<MetaLocation[]>(draft?.selectedLocations ?? [DEFAULT_COUNTRIES[0]]);
  const [locationOptions, setLocationOptions] = useState<MetaLocation[]>(DEFAULT_COUNTRIES);
  const [locationSearch, setLocationSearch] = useState('');
  const [locationLoading, setLocationLoading] = useState(false);
  const [budget, setBudget] = useState(draft?.budget ?? (existingDraft ? String(existingDraft.budget) : '100'));
  const [startDate, setStartDate] = useState(draft?.startDate ?? todayStr);
  const [endDate, setEndDate] = useState(draft?.endDate ?? defaultEndDate);
  const [usePijamaAudience, setUsePijamaAudience] = useState(draft?.usePijamaAudience ?? existingDraft?.includeBaseAudiences ?? true);
  const [showAudienceWarning, setShowAudienceWarning] = useState(false);
  const [showHowItWorks, setShowHowItWorks] = useState(!howItWorksDismissed);
  const [dontShowAgain, setDontShowAgain] = useState(false);
  const [selectedGenres, setSelectedGenres] = useState<string[]>(() => {
    if (draft?.selectedGenres) return draft.selectedGenres;
    if (existingDraft?.filmGenres?.length) return existingDraft.filmGenres;
    const filmCategories = film.genre || [];
    // Map film categories to FILM_GENRES values, matching by label or value
    return filmCategories
      .map((cat) => {
        const match = FILM_GENRES.find(
          (g) => g.value.toLowerCase() === cat.toLowerCase() || g.label.toLowerCase() === cat.toLowerCase()
        );
        return match?.value;
      })
      .filter((v): v is string => Boolean(v));
  });

  // Date validation state
  const [dateError, setDateError] = useState<string | null>(null);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Account balance state
  const [accountBalance, setAccountBalance] = useState(initialBalance);
  const [addFundsOpen, setAddFundsOpen] = useState(false);
  const [fundAmount, setFundAmount] = useState<number | null>(100);
  const [fundCustomAmount, setFundCustomAmount] = useState('');
  const [fundLoading, setFundLoading] = useState(false);
  const [fundError, setFundError] = useState<string | null>(null);

  const router = useRouter();

  // Form state - Copies (multi-language, generated via API)
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(draft?.selectedLanguages ?? ['es']);
  const [loadingLanguages, setLoadingLanguages] = useState<Set<string>>(new Set());
  const [copiesByLang, setCopiesByLang] = useState<Record<string, Record<string, { headline: string; description: string }>>>(draft?.copiesByLang ?? {});
  const [currentCopyLanguage, setCurrentCopyLanguage] = useState(draft?.selectedLanguages?.[0] ?? 'es');

  // Copies for the currently selected language (convenience accessor)
  const copies = useMemo(() => copiesByLang[currentCopyLanguage] || {}, [copiesByLang, currentCopyLanguage]);

  // Campaign name state (editable in summary tab)
  const [campaignName, setCampaignName] = useState(draft?.campaignName ?? existingDraft?.name ?? `${film.title} - Campaign`);

  // Local assets state (initialized from server, updated via SSE)
  const [localImageAssets, setLocalImageAssets] = useState<LocalAsset[]>(localImages);
  const [localVideoAssets, setLocalVideoAssets] = useState<LocalAsset[]>(localVideos);

  // Form state - Media Assets (start with all local DB assets selected, or draft selection)
  const [selectedAssets, setSelectedAssets] = useState<string[]>(() => {
    if (draft?.selectedAssets) return draft.selectedAssets;
    return [
      ...localImages.map((asset) => asset.id),
      ...localVideos.map((asset) => asset.id),
    ];
  });
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerAsset, setViewerAsset] = useState<LocalAsset | UploadedAsset | null>(null);

  // Uploaded assets (newly uploaded during this session)
  const [uploadedAssets, setUploadedAssets] = useState<UploadedAsset[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Asset filter state
  const [assetFilter, setAssetFilter] = useState<AssetFilter>('all');

  // Preview state
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [iframeLoading, setIframeLoading] = useState(false);
  const [iframeRetryCount, setIframeRetryCount] = useState(0);

  // Campaign progress state for SSE
  const [campaignProgress, setCampaignProgress] = useState<{
    step: string;
    progress: number;
    message: string;
    error: string;
  }>({ step: '', progress: 0, message: '', error: '' });

  // Preview navigation state
  const [previewAssetIndex, setPreviewAssetIndex] = useState(0);
  const [previewVariant, setPreviewVariant] = useState<'A' | 'B' | 'C'>('A');

  // Budget amount for validation
  const budgetAmount = Number(budget) || 0;

  // Compute merged assets (local DB assets + newly uploaded)
  const allVideos = useMemo(
    () => [...localVideoAssets, ...uploadedAssets.filter((a) => a.type === 'video')],
    [localVideoAssets, uploadedAssets]
  );

  const allImages = useMemo(
    () => [...localImageAssets, ...uploadedAssets.filter((a) => a.type === 'image')],
    [localImageAssets, uploadedAssets]
  );

  // Filter assets by status
  const filterAsset = useCallback((asset: LocalAsset | UploadedAsset) => {
    switch (assetFilter) {
      case 'ready':
        return asset.status === 'READY';
      case 'validating':
        return asset.status === 'VALIDATING' || asset.status === 'PENDING';
      case 'invalid':
        return asset.status === 'INVALID' || asset.status === 'ERROR';
      default:
        return true;
    }
  }, [assetFilter]);

  const filteredVideos = useMemo(() => allVideos.filter(filterAsset), [allVideos, filterAsset]);
  const filteredImages = useMemo(() => allImages.filter(filterAsset), [allImages, filterAsset]);

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

  // Tab validation memos
  const isScheduleValid = useMemo(() => {
    return selectedPlatforms.length > 0 &&
      budget !== '' && Number(budget) > 0 &&
      startDate !== '' && endDate !== '' &&
      !dateError && selectedLocations.length > 0 &&
      selectedLanguages.length > 0;
  }, [selectedPlatforms, budget, startDate, endDate, dateError, selectedLocations, selectedLanguages]);

  const isCopiesValid = useMemo(() => {
    return selectedLanguages.every(lang => {
      const langCopies = copiesByLang[lang];
      return langCopies && Object.keys(langCopies).length > 0 &&
        Object.values(langCopies).some(c => c.headline && c.description);
    });
  }, [copiesByLang, selectedLanguages]);

  const isMediaValid = useMemo(() => selectedAssets.length > 0, [selectedAssets]);

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

    const previewTabs = selectedPlatforms.map(pId => PLATFORMS.find(p => p.id === pId)!).filter(Boolean);
    const currentPlatform = previewTabs[rightTab] || PLATFORMS[0];

    // YouTube preview is rendered client-side, no API call needed
    if (currentPlatform.platform === 'GOOGLE') {
      setPreviewHtml(null);
      setPreviewError(null);
      setPreviewLoading(false);
      return;
    }

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
          setPreviewError('The video is still being processed. Preview will be available soon.');
        } else {
          throw new Error(error.details || error.error || 'Error generating preview');
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
  }, [rightTab, selectedAdStyle, previewableAssets, previewAssetIndex, copies, previewVariant, film.trailerUrl, selectedPlatforms]);

  // SSE listener for background asset sync notifications
  useEffect(() => {
    const mercureUrl = new URL(process.env.NEXT_PUBLIC_MERCURE_URL!);
    mercureUrl.searchParams.set('topic', `https://promote.pijamafilms.com/films/${film.id}/events`);
    const eventSource = new EventSource(mercureUrl.toString());

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
                status: 'PENDING' as AssetStatus,
                facebookEligible: false,
                instagramEligible: false,
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
                status: 'PENDING' as AssetStatus,
                facebookEligible: false,
                instagramEligible: false,
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

        // Handle image validation events
        if (data.type === 'image_validated') {
          console.log(`[SSE] Image ${data.imageId} validated: ${data.status}`);
          const updateImage = (a: LocalAsset | UploadedAsset) =>
            a.id === data.imageId
              ? {
                  ...a,
                  status: data.status as AssetStatus,
                  validationError: data.errors?.join('; ') || null,
                  aspectRatio: data.aspectRatio,
                }
              : a;
          setLocalImageAssets((prev) => prev.map(updateImage));
          setUploadedAssets((prev) => prev.map(updateImage));
          // Uncheck if invalid
          if (data.status === 'INVALID' || data.status === 'ERROR') {
            setSelectedAssets((prev) => prev.filter((id) => id !== data.imageId));
          }
        }

        // Handle video validation events
        if (data.type === 'video_validated') {
          console.log(`[SSE] Video ${data.videoId} validated: ${data.status}`);
          const updateVideo = (a: LocalAsset | UploadedAsset) =>
            a.id === data.videoId
              ? {
                  ...a,
                  status: data.status as AssetStatus,
                  validationError: data.errors?.join('; ') || null,
                  aspectRatio: data.aspectRatio,
                }
              : a;
          setLocalVideoAssets((prev) => prev.map(updateVideo));
          setUploadedAssets((prev) => prev.map(updateVideo));
          // Uncheck if invalid
          if (data.status === 'INVALID' || data.status === 'ERROR') {
            setSelectedAssets((prev) => prev.filter((id) => id !== data.videoId));
          }
        }

        // Handle image eligibility events
        if (data.type === 'image_eligibility_checked') {
          console.log(`[SSE] Image ${data.imageId} eligibility: FB=${data.facebookEligible}, IG=${data.instagramEligible}`);
          const updateImage = (a: LocalAsset | UploadedAsset) =>
            a.id === data.imageId
              ? {
                  ...a,
                  facebookEligible: data.facebookEligible,
                  instagramEligible: data.instagramEligible,
                  eligibilityError: data.error,
                }
              : a;
          setLocalImageAssets((prev) => prev.map(updateImage));
          setUploadedAssets((prev) => prev.map(updateImage));
        }

        // Handle video eligibility events
        if (data.type === 'video_eligibility_checked') {
          console.log(`[SSE] Video ${data.videoId} eligibility: FB=${data.facebookEligible}, IG=${data.instagramEligible}`);
          const updateVideo = (a: LocalAsset | UploadedAsset) =>
            a.id === data.videoId
              ? {
                  ...a,
                  facebookEligible: data.facebookEligible,
                  instagramEligible: data.instagramEligible,
                  eligibilityError: data.error,
                }
              : a;
          setLocalVideoAssets((prev) => prev.map(updateVideo));
          setUploadedAssets((prev) => prev.map(updateVideo));
        }

        // Handle campaign progress events
        if (data.type === 'campaign_progress') {
          console.log(`[SSE] Campaign progress: ${data.step} - ${data.progress}%`);
          setCampaignProgress({
            step: data.step,
            progress: data.progress,
            message: data.message,
            error: '',
          });
        }

        // Handle campaign error events
        if (data.type === 'campaign_error') {
          console.error(`[SSE] Campaign error: ${data.error}`);
          setCampaignProgress((prev) => ({
            ...prev,
            error: data.error,
          }));
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

  // Auto-generate copies for any languages missing copies when entering the Ad Copy tab
  useEffect(() => {
    if (leftTab === 1) {
      generateAllCopies();
    }
  }, [leftTab, selectedLanguages]);

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

  // Date validation effect
  useEffect(() => {
    if (startDate && endDate && new Date(endDate) <= new Date(startDate)) {
      setDateError('End date must be after start date');
    } else {
      setDateError(null);
    }
  }, [startDate, endDate]);

  // Handle payment return from Stripe checkout
  useEffect(() => {
    if (paymentStatus === 'success' && paymentSessionId) {
      (async () => {
        try {
          const res = await fetch('/api/account/verify-session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: paymentSessionId }),
          });
          if (res.ok) {
            const data = await res.json();
            if (data.balance !== undefined) {
              setAccountBalance(data.balance);
            }
            setSubmitError(null);
          }
        } catch (error) {
          console.error('Error verifying payment session:', error);
        }
        // Clean up URL params
        const url = new URL(window.location.href);
        url.searchParams.delete('payment');
        url.searchParams.delete('session_id');
        window.history.replaceState({}, '', url.toString());
      })();
    }
  }, [paymentStatus, paymentSessionId]);

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
    setCopiesByLang(prev => ({
      ...prev,
      [currentCopyLanguage]: {
        ...prev[currentCopyLanguage],
        [variant]: { ...(prev[currentCopyLanguage]?.[variant]), [field]: value },
      },
    }));
  };

  const generateCopiesForLanguage = async (langCode: string) => {
    setLoadingLanguages(prev => new Set(prev).add(langCode));

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

      setCopiesByLang(prev => ({ ...prev, [langCode]: formattedCopies }));
    } catch (error) {
      console.error('Error generating copies:', error);
      setCopiesByLang(prev => ({ ...prev, [langCode]: emptyCopies }));
    }

    setLoadingLanguages(prev => {
      const next = new Set(prev);
      next.delete(langCode);
      return next;
    });
  };

  const generateAllCopies = async () => {
    const langsToGenerate = selectedLanguages.filter(
      lang => !copiesByLang[lang] || Object.keys(copiesByLang[lang]).length === 0
    );
    if (langsToGenerate.length === 0) return;

    await Promise.all(langsToGenerate.map(lang => generateCopiesForLanguage(lang)));
  };

  const handleDeleteVariant = (variant: 'A' | 'B' | 'C') => {
    setCopiesByLang(prev => {
      const langCopies = { ...prev[currentCopyLanguage] };
      delete langCopies[variant];
      return { ...prev, [currentCopyLanguage]: langCopies };
    });
  };

  const handleAddVariant = (variant: 'A' | 'B' | 'C') => {
    setCopiesByLang(prev => ({
      ...prev,
      [currentCopyLanguage]: {
        ...prev[currentCopyLanguage],
        [variant]: { headline: '', description: '' },
      },
    }));
  };

  const getAvailableVariants = () => {
    const existingVariants = Object.keys(copies);
    return (['A', 'B', 'C'] as const).filter(v => !existingVariants.includes(v));
  };

  // Handle revalidation request
  const handleRevalidate = async (assetId: string, assetType: 'image' | 'video') => {
    try {
      const response = await fetch(`/api/assets/${assetId}/revalidate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: assetType, filmMuviUuid: film.id }),
      });

      if (!response.ok) {
        throw new Error('Failed to trigger revalidation');
      }

      console.log(`Revalidation triggered for ${assetType} ${assetId}`);
    } catch (error) {
      console.error('Error triggering revalidation:', error);
    }
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
          status: result.status || 'PENDING',
          facebookEligible: result.facebookEligible || false,
          instagramEligible: result.instagramEligible || false,
          validationError: result.validationError,
          aspectRatio: result.aspectRatio,
          eligibilityError: result.eligibilityError,
        };

        setUploadedAssets(prev => [...prev, newAsset]);
        setSelectedAssets(prev => [...prev, newAsset.id]);
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : 'Upload failed');
      }
    }
    setUploading(false);
  };

  // Compute preview tabs from selected platforms
  const previewTabs = useMemo(() =>
    selectedPlatforms.map(pId => PLATFORMS.find(p => p.id === pId)!).filter(Boolean),
    [selectedPlatforms]
  );
  const currentPlatform = previewTabs[rightTab] || PLATFORMS[0];

  // Reset rightTab when selectedPlatforms changes
  useEffect(() => {
    setRightTab(0);
  }, [selectedPlatforms]);

  // Map gender string to Meta API number array
  const mapGender = (genderValue: string): number[] => {
    switch (genderValue) {
      case 'MALE': return [1];
      case 'FEMALE': return [2];
      case 'ALL':
      default: return [];
    }
  };

  // Save current form state as a draft
  const saveDraft = async (): Promise<string | null> => {
    setSavingDraft(true);
    try {
      // Determine AdPlatform values from selected platforms
      const platformValues = [...new Set(
        selectedPlatforms.map(pId => {
          const p = PLATFORMS.find(pl => pl.id === pId);
          return p?.platform || 'META';
        })
      )] as ('META' | 'GOOGLE')[];

      const formState: DraftFormState = {
        selectedPlatforms,
        selectedAdStyle,
        ageMin,
        ageMax,
        gender,
        selectedLocations,
        budget,
        startDate,
        endDate,
        usePijamaAudience,
        selectedGenres,
        selectedLanguages,
        copiesByLang,
        selectedAssets,
        campaignName,
      };

      const res = await fetch('/api/campaigns/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          draftId: draftId || undefined,
          campaignData: {
            name: campaignName,
            budget: Number(budget) || 0,
            startDate: new Date(startDate),
            endDate: endDate ? new Date(endDate) : undefined,
            targetCountries: selectedLocations.map(loc => loc.country_code || loc.key),
            targetAgeMin: ageMin,
            targetAgeMax: ageMax,
            targetGenders: mapGender(gender),
            includeBaseAudiences: usePijamaAudience,
            filmGenres: selectedGenres,
            includeLgbtAudience: gender === 'LGBTQ',
            filmMuviUuid: film.id,
            platforms: platformValues,
            language: selectedLanguages[0] || 'es',
          },
          formState,
        }),
      });

      if (!res.ok) {
        console.error('Failed to save draft');
        return draftId;
      }

      const data = await res.json();
      const newDraftId = data.campaign.id;
      setDraftId(newDraftId);
      return newDraftId;
    } catch (error) {
      console.error('Error saving draft:', error);
      return draftId;
    } finally {
      setSavingDraft(false);
    }
  };

  // Map form state to API schema including ads
  const mapFormToAPI = () => {
    // Get headlines and bodies from all languages and variants
    const headlines = Object.values(copiesByLang)
      .flatMap(langCopies => Object.values(langCopies).map(v => v.headline))
      .filter(Boolean);
    const bodies = Object.values(copiesByLang)
      .flatMap(langCopies => Object.values(langCopies).map(v => v.description))
      .filter(Boolean);

    // Get selected image and video IDs
    const imageIds = selectedAssets.filter(id =>
      allImages.some(img => img.id === id)
    );
    const videoIds = selectedAssets.filter(id =>
      allVideos.some(vid => vid.id === id)
    );

    // Determine AdPlatform values from selected platforms (deduplicated)
    const platformValues = [...new Set(
      selectedPlatforms.map(pId => {
        const p = PLATFORMS.find(pl => pl.id === pId);
        return p?.platform || 'META';
      })
    )];

    // Create single ad with all copy variants
    const ad = {
      name: `${film.title} - ${selectedLanguages.map(l => l.toUpperCase()).join('/')}`,
      language: selectedLanguages[0] || 'es',
      headlines: headlines.length > 0 ? headlines : [`Descubre ${film.title}`],
      bodies: bodies.length > 0 ? bodies : [film.description || `A film you can't miss`],
      descriptions: [],
      callToAction: 'LEARN_MORE',
      linkUrl: film.trailerUrl || `https://pijama.film/films/${film.id}`,
      imageIds,
      videoIds,
    };

    const basePayload = {
      name: campaignName,
      objective: 'LANDING_PAGE_VIEW' as const,
      languages: selectedLanguages,
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
      platforms: platformValues,
      ads: [ad],
      autoSync: true,
    };

    return basePayload;
  };

  // Submit campaign with ads to API and auto-sync
  const handleSubmit = async () => {
    setSubmitting(true);
    setSubmitError(null);

    try {
      const payload = mapFormToAPI();

      // Validate we have at least one ad with media
      const hasMedia = payload.ads.some(ad => ad.imageIds.length > 0 || ad.videoIds.length > 0);
      if (!hasMedia) {
        throw new Error('Select at least one image or video for your campaign');
      }

      const hasMetaPlatform = selectedPlatforms.some(p => p !== 'youtube');
      const hasGoogle = selectedPlatforms.includes('youtube');

      // Include draftId if resuming from a draft
      const payloadWithDraft = draftId ? { ...payload, draftId } : payload;

      let campaignId: string | undefined;

      // If Meta platform selected, create via Meta API first
      if (hasMetaPlatform) {
        const metaResponse = await fetch('/api/meta/campaigns/create-and-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payloadWithDraft),
        });

        if (!metaResponse.ok) {
          const error = await metaResponse.json();
          throw new Error(error.error || error.details?.fieldErrors?.toString() || 'Error creating campaign');
        }

        const metaResult = await metaResponse.json();
        campaignId = metaResult.campaign.id;

        if (metaResult.syncError) {
          console.warn('Campaign created but Meta sync failed:', metaResult.syncError);
        }
        if (metaResult.adErrors?.length > 0) {
          console.warn('Some Meta ads failed to sync:', metaResult.adErrors);
        }

        // If Google also selected, sync same campaign to Google
        if (hasGoogle) {
          const googlePayload = {
            ...payload,
            campaignId, // Reuse existing campaign
            googleBidStrategy: 'TARGET_CPV',
          };

          const googleResponse = await fetch('/api/google/campaigns/create-and-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(googlePayload),
          });

          if (!googleResponse.ok) {
            const error = await googleResponse.json();
            console.warn('Google sync failed:', error.error || 'Error syncing to Google');
          } else {
            const googleResult = await googleResponse.json();
            if (googleResult.syncError) {
              console.warn('Google sync issue:', googleResult.syncError);
            }
          }
        }
      } else if (hasGoogle) {
        // Only Google selected
        const googlePayload = {
          ...payloadWithDraft,
          googleBidStrategy: 'TARGET_CPV',
        };

        const googleResponse = await fetch('/api/google/campaigns/create-and-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(googlePayload),
        });

        if (!googleResponse.ok) {
          const error = await googleResponse.json();
          throw new Error(error.error || error.details?.fieldErrors?.toString() || 'Error creating campaign');
        }

        const googleResult = await googleResponse.json();
        campaignId = googleResult.campaign.id;

        if (googleResult.syncError) {
          console.warn('Campaign created but Google sync failed:', googleResult.syncError);
        }
      }

      // Charge campaign budget from account
      if (campaignId) {
        const chargeResponse = await fetch('/api/account/charge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            campaignId,
            amount: parseFloat(budget),
            campaignName,
          }),
        });

        if (!chargeResponse.ok) {
          const chargeError = await chargeResponse.json();
          throw new Error(chargeError.error || 'Error charging campaign budget');
        }

        // Update local balance
        setAccountBalance((prev) => prev - parseFloat(budget));

        router.push(`/films/${film.id}/campaigns/${campaignId}`);
      }
    } catch (error) {
      console.error('Error creating campaign:', error);
      setSubmitError(error instanceof Error ? error.message : 'Error creating campaign');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      {/* Header */}
      <Box sx={{ mb: 4, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <Box>
          <Typography variant="h3" component="h1" gutterBottom>
            Create Campaign
          </Typography>
          <Typography variant="h5" color="text.secondary">
            {film.title}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<HelpIcon />}
          onClick={() => setShowHowItWorks(true)}
        >
          How it Works
        </Button>
      </Box>

      {/* Two Column Layout */}
      <Grid container spacing={4}>
        {/* Left Column - Input Tabs */}
        <Grid size={{ xs: 12, md: 7 }}>
          <Paper sx={{ p: 3 }}>
            <Tabs value={leftTab} onChange={(e, v) => setLeftTab(v)} sx={{ mb: 3 }}>
              <Tab label="Schedule" />
              <Tab label="Ad Copy" disabled={!isScheduleValid} />
              <Tab label="Media" disabled={!isScheduleValid || !isCopiesValid} />
              <Tab label="Summary" disabled={!isScheduleValid || !isCopiesValid || !isMediaValid} />
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
                            label={
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                                {platform.id === 'facebook' && <FacebookIcon sx={{ fontSize: 18, color: '#1877F2' }} />}
                                {platform.id === 'instagram' && <InstagramIcon sx={{ fontSize: 18, color: '#E4405F' }} />}
                                {platform.id === 'youtube' && <YouTubeIcon sx={{ fontSize: 18, color: '#FF0000' }} />}
                                {platform.name}
                              </Box>
                            }
                          />
                        ))}
                      </FormGroup>
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

                  <Grid size={{ xs: 12 }}>
                    <Autocomplete
                      multiple
                      options={LANGUAGES}
                      getOptionLabel={(option) => option.name}
                      value={LANGUAGES.filter(l => selectedLanguages.includes(l.code))}
                      onChange={(_, newValue) => setSelectedLanguages(newValue.map(v => v.code))}
                      isOptionEqualToValue={(option, value) => option.code === value.code}
                      renderInput={(params) => (
                        <TextField
                          {...params}
                          label="Languages"
                          placeholder="Select languages"
                        />
                      )}
                      renderTags={(value, getTagProps) =>
                        value.map((option, index) => {
                          const { key, ...tagProps } = getTagProps({ index });
                          return <Chip key={key} label={option.name} {...tagProps} />;
                        })
                      }
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
                      inputProps={{ min: todayStr }}
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
                      inputProps={{ min: startDate || undefined }}
                      error={!!dateError}
                      helperText={dateError}
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
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <FormControlLabel
                          control={
                            <Switch
                              checked={usePijamaAudience}
                              onChange={(e) => {
                                if (!e.target.checked) {
                                  setShowAudienceWarning(true);
                                } else {
                                  setUsePijamaAudience(true);
                                }
                              }}
                            />
                          }
                          label={
                            <Box>
                              <Typography variant="subtitle1" component="span" sx={{ fontWeight: 'bold', color: 'primary.main' }}>
                                Pijama Audience
                              </Typography>
                              <Typography variant="body2" display="block" color="text.secondary">
                                {usePijamaAudience
                                  ? 'Optimize your campaign using our specialized data for independent film. We take care of finding the best audience for your film.'
                                  : 'Manually configure your audience targeting. Define age, gender, and film categories.'}
                              </Typography>
                            </Box>
                          }
                        />
                        <Chip
                          label={usePijamaAudience ? 'RECOMMENDED' : 'MANUAL TARGETING'}
                          size="small"
                          sx={{
                            ml: 2,
                            flexShrink: 0,
                            fontWeight: 'bold',
                            bgcolor: usePijamaAudience ? 'primary.main' : 'grey.400',
                            color: usePijamaAudience ? 'primary.contrastText' : 'white',
                          }}
                        />
                      </Box>
                    </Paper>
                  </Grid>

                  <Grid size={{ xs: 12 }}>
                    <Collapse in={!usePijamaAudience} timeout="auto">
                      <Grid container spacing={3}>
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
                              {/* Hidden temporarily - <FormControlLabel value="LGBTQ" control={<Radio />} label="LGBTQ+" /> */}
                            </RadioGroup>
                          </FormControl>
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
                                label="Category"
                                placeholder="Select categories"
                                helperText="Target audiences interested in these film categories"
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
                    </Collapse>
                  </Grid>

                </Grid>
              </Box>
            )}

            {/* Tab 2: Creatives */}
            {leftTab === 1 && (
              <Box>
                {selectedLanguages.length > 1 && (
                  <FormControl fullWidth sx={{ mb: 3 }}>
                    <InputLabel>Language</InputLabel>
                    <Select
                      value={currentCopyLanguage}
                      onChange={(e) => {
                        const lang = e.target.value;
                        setCurrentCopyLanguage(lang);
                        if (!copiesByLang[lang] || Object.keys(copiesByLang[lang]).length === 0) {
                          generateCopiesForLanguage(lang);
                        }
                      }}
                      label="Language"
                    >
                      {selectedLanguages.map(code => (
                        <MenuItem key={code} value={code}>
                          {LANGUAGES.find(l => l.code === code)?.name || code}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                )}
                {loadingLanguages.has(currentCopyLanguage) ? (
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

                {/* Filter Controls */}
                <Box sx={{ mb: 3 }}>
                  <Typography variant="subtitle2" gutterBottom>
                    Filter by Status
                  </Typography>
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

                <Typography variant="h6" gutterBottom>
                  Videos ({filteredVideos.length})
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
                  {filteredVideos.map((asset) => (
                    <Card
                      key={asset.id}
                      sx={{
                        width: 140,
                        position: 'relative',
                        border: selectedAssets.includes(asset.id) ? '2px solid' : '1px solid',
                        borderColor: selectedAssets.includes(asset.id) ? 'primary.main' : 'divider',
                        opacity: asset.status === 'INVALID' || asset.status === 'ERROR' ? 0.7 : 1,
                      }}
                    >
                      {/* Checkbox */}
                      <Box sx={{ position: 'absolute', top: 2, left: 2, zIndex: 2 }}>
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

                      {/* Status chip */}
                      <Chip
                        label={ASSET_STATUS_LABELS[asset.status]}
                        size="small"
                        color={ASSET_STATUS_COLORS[asset.status]}
                        sx={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          fontSize: '0.6rem',
                          height: 18,
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
                        <Typography variant="caption" noWrap sx={{ fontSize: '0.7rem', display: 'block' }}>
                          {asset.name}
                        </Typography>
                        {/* Platform eligibility icons */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                          {asset.status === 'READY' && (
                            <>
                              {asset.facebookEligible && (
                                <Tooltip title="Facebook eligible">
                                  <FacebookIcon sx={{ fontSize: 14, color: '#1877F2' }} />
                                </Tooltip>
                              )}
                              {asset.instagramEligible && (
                                <Tooltip title="Instagram eligible">
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
                          {(asset.status === 'INVALID' || asset.status === 'ERROR') && (
                            <Tooltip title="Retry validation">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRevalidate(asset.id, 'video');
                                }}
                                sx={{ p: 0.25 }}
                              >
                                <RefreshIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </CardContent>
                    </Card>
                  ))}
                </Box>

                <Typography variant="h6" gutterBottom>
                  Images ({filteredImages.length})
                </Typography>
                <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                  {filteredImages.map((asset) => (
                    <Card
                      key={asset.id}
                      sx={{
                        width: 140,
                        position: 'relative',
                        border: selectedAssets.includes(asset.id) ? '2px solid' : '1px solid',
                        borderColor: selectedAssets.includes(asset.id) ? 'primary.main' : 'divider',
                        opacity: asset.status === 'INVALID' || asset.status === 'ERROR' ? 0.7 : 1,
                      }}
                    >
                      {/* Checkbox */}
                      <Box sx={{ position: 'absolute', top: 2, left: 2, zIndex: 2 }}>
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

                      {/* Status chip */}
                      <Chip
                        label={ASSET_STATUS_LABELS[asset.status]}
                        size="small"
                        color={ASSET_STATUS_COLORS[asset.status]}
                        sx={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          fontSize: '0.6rem',
                          height: 18,
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
                        <Typography variant="caption" noWrap sx={{ fontSize: '0.7rem', display: 'block' }}>
                          {asset.name}
                        </Typography>
                        {/* Platform eligibility icons */}
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}>
                          {asset.status === 'READY' && (
                            <>
                              {asset.facebookEligible && (
                                <Tooltip title="Facebook eligible">
                                  <FacebookIcon sx={{ fontSize: 14, color: '#1877F2' }} />
                                </Tooltip>
                              )}
                              {asset.instagramEligible && (
                                <Tooltip title="Instagram eligible">
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
                          {(asset.status === 'INVALID' || asset.status === 'ERROR') && (
                            <Tooltip title="Retry validation">
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleRevalidate(asset.id, 'image');
                                }}
                                sx={{ p: 0.25 }}
                              >
                                <RefreshIcon sx={{ fontSize: 14 }} />
                              </IconButton>
                            </Tooltip>
                          )}
                        </Box>
                      </CardContent>
                    </Card>
                  ))}
                </Box>
              </Box>
            )}

            {/* Tab 4: Summary */}
            {leftTab === 3 && (
              <Box>
                {/* Editable Campaign Name */}
                <TextField
                  fullWidth
                  label="Campaign Name"
                  value={campaignName}
                  onChange={(e) => setCampaignName(e.target.value)}
                  sx={{ mb: 4 }}
                />

                {/* Summary Cards */}
                <Grid container spacing={2}>
                  {/* Schedule Summary */}
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Schedule
                      </Typography>
                      <Typography variant="body2">
                        <strong>Start:</strong> {startDate || 'Not set'}
                      </Typography>
                      <Typography variant="body2">
                        <strong>End:</strong> {endDate || 'Not set'}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Budget:</strong> ${budget || '0'}
                      </Typography>
                    </Paper>
                  </Grid>

                  {/* Targeting Summary */}
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Targeting
                      </Typography>
                      <Typography variant="body2">
                        <strong>Platforms:</strong> {selectedPlatforms.map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(', ') || 'None'}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Countries:</strong> {selectedLocations.map(l => l.name).join(', ') || 'None'}
                      </Typography>
                      {usePijamaAudience ? (
                        <Typography variant="body2">
                          <strong>Audience:</strong> Pijama Audience (optimized)
                        </Typography>
                      ) : (
                        <>
                          <Typography variant="body2">
                            <strong>Age:</strong> {ageMin} - {ageMax}
                          </Typography>
                          <Typography variant="body2">
                            <strong>Gender:</strong> {gender === 'ALL' ? 'All' : gender === 'MALE' ? 'Male' : 'Female'}
                          </Typography>
                          <Typography variant="body2">
                            <strong>Categories:</strong> {selectedGenres.length > 0 ? selectedGenres.join(', ') : 'None'}
                          </Typography>
                        </>
                      )}
                    </Paper>
                  </Grid>

                  {/* Media Summary */}
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Media
                      </Typography>
                      <Typography variant="body2">
                        <strong>Images:</strong> {selectedImages.length}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Videos:</strong> {selectedVideos.length}
                      </Typography>
                    </Paper>
                  </Grid>

                  {/* Copy Summary */}
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <Paper variant="outlined" sx={{ p: 2 }}>
                      <Typography variant="subtitle2" color="text.secondary" gutterBottom>
                        Ad Copy
                      </Typography>
                      <Typography variant="body2">
                        <strong>Languages:</strong> {selectedLanguages.map(code => LANGUAGES.find(l => l.code === code)?.name || code).join(', ') || 'None'}
                      </Typography>
                      <Typography variant="body2">
                        <strong>Variants:</strong> {Object.keys(copies).join(', ') || 'None'} ({selectedLanguages.length} {selectedLanguages.length === 1 ? 'language' : 'languages'})
                      </Typography>
                    </Paper>
                  </Grid>
                </Grid>

                {/* Balance Check Card */}
                <Paper
                  variant="outlined"
                  sx={{
                    p: 2,
                    mt: 3,
                    borderColor: accountBalance < parseFloat(budget || '0') ? 'error.main' : 'success.main',
                    bgcolor: accountBalance < parseFloat(budget || '0') ? 'error.50' : 'success.50',
                  }}
                >
                  <Typography variant="subtitle2" gutterBottom>
                    Account Balance
                  </Typography>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2">Available balance:</Typography>
                    <Typography variant="body2" fontWeight="bold">${accountBalance.toFixed(2)}</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="body2">Campaign budget:</Typography>
                    <Typography variant="body2" fontWeight="bold">-${parseFloat(budget || '0').toFixed(2)}</Typography>
                  </Box>
                  <Divider sx={{ my: 1 }} />
                  <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
                    <Typography variant="body2">Balance after:</Typography>
                    <Typography
                      variant="body2"
                      fontWeight="bold"
                      color={accountBalance - parseFloat(budget || '0') < 0 ? 'error.main' : 'success.main'}
                    >
                      ${(accountBalance - parseFloat(budget || '0')).toFixed(2)}
                    </Typography>
                  </Box>
                  {accountBalance < parseFloat(budget || '0') && (
                    <Box sx={{ mt: 2 }}>
                      <Alert severity="error" sx={{ mb: 1 }}>
                        Insufficient balance for this campaign.
                      </Alert>
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => setAddFundsOpen(true)}
                      >
                        Add Funds
                      </Button>
                    </Box>
                  )}
                </Paper>

                {/* Progress Bar during submission */}
                {submitting && (
                  <Box sx={{ mt: 4 }}>
                    <LinearProgress
                      variant={campaignProgress.progress > 0 ? 'determinate' : 'indeterminate'}
                      value={campaignProgress.progress}
                      sx={{ mb: 1 }}
                    />
                    <Typography variant="body2" color="text.secondary" align="center">
                      {campaignProgress.message || 'Creating campaign...'}
                    </Typography>
                  </Box>
                )}
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
                <Button
                  variant="outlined"
                  disabled={savingDraft}
                  onClick={async () => {
                    const id = await saveDraft();
                    if (id && !draftId) {
                      // Update URL with draft ID for future saves
                      const url = new URL(window.location.href);
                      url.searchParams.set('draft', id);
                      window.history.replaceState({}, '', url.toString());
                    }
                  }}
                >
                  {savingDraft ? 'Saving...' : (draftId ? 'Draft Saved' : 'Save Draft')}
                </Button>
                {leftTab < 3 ? (
                  <Button
                    variant="contained"
                    size="large"
                    onClick={() => setLeftTab(leftTab + 1)}
                    disabled={
                      (leftTab === 0 && !isScheduleValid) ||
                      (leftTab === 1 && !isCopiesValid) ||
                      (leftTab === 2 && !isMediaValid)
                    }
                  >
                    Next
                  </Button>
                ) : (
                  <Button
                    variant="contained"
                    size="large"
                    disabled={!isScheduleValid || !isCopiesValid || !isMediaValid || submitting || accountBalance < parseFloat(budget || '0')}
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
            <Tabs value={rightTab} onChange={(e, v) => {
              setRightTab(v);
              // Reset ad style when switching to a platform with different styles
              const newPlatform = previewTabs[v];
              if (newPlatform && !newPlatform.adStyles.includes(selectedAdStyle)) {
                setSelectedAdStyle(newPlatform.adStyles[0]);
              }
            }} sx={{ mb: 2 }}>
              {previewTabs.map((p) => (
                <Tab key={p.id} label={p.name} />
              ))}
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
                    Generating preview...
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
                    Retry
                  </Button>
                </Box>
              ) : currentPlatform.platform === 'GOOGLE' ? (
                // YouTube preview rendered client-side
                (() => {
                  const hasMedia = selectedAssets.length > 0;
                  const hasCopy = copies[previewVariant]?.headline;
                  if (!hasMedia || !hasCopy) {
                    return (
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
                          p: 3,
                        }}
                      >
                        <Typography color="text.secondary" align="center">
                          {!hasMedia ? 'Select media to see YouTube preview' : 'Add copy text to see YouTube preview'}
                        </Typography>
                      </Box>
                    );
                  }
                  return (
                    <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                      <YouTubeAdPreview
                        adFormat={getYouTubeFormat(selectedAdStyle)}
                        headline={copies[previewVariant]?.headline}
                        description={copies[previewVariant]?.description}
                        thumbnailUrl={previewableAssets[previewAssetIndex]?.thumbnailUrl || previewableAssets[previewAssetIndex]?.url}
                      />
                    </Box>
                  );
                })()
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
                (() => {
                  // Determine the reason for empty preview
                  const hasMedia = selectedAssets.length > 0;
                  const hasCopy = copies[previewVariant]?.headline;
                  const currentAsset = previewableAssets[previewAssetIndex];
                  const isVideoWithoutMetaId = currentAsset?.type === 'video' && !currentAsset.metaVideoId;

                  // No media selected
                  if (!hasMedia) {
                    return (
                      <Box
                        sx={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexDirection: 'column',
                          gap: 2,
                          bgcolor: 'background.default',
                          border: '1px dashed',
                          borderColor: 'divider',
                          borderRadius: 1,
                          p: 4,
                          minHeight: 300,
                        }}
                      >
                        <ImageIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                        <Typography color="text.secondary" align="center">
                          Select at least one image or video to see the preview
                        </Typography>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => setLeftTab(2)}
                        >
                          Go to Media
                        </Button>
                      </Box>
                    );
                  }

                  // No copy text
                  if (!hasCopy) {
                    return (
                      <Box
                        sx={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexDirection: 'column',
                          gap: 2,
                          bgcolor: 'background.default',
                          border: '1px dashed',
                          borderColor: 'divider',
                          borderRadius: 1,
                          p: 4,
                          minHeight: 300,
                        }}
                      >
                        <TextFieldsIcon sx={{ fontSize: 48, color: 'text.disabled' }} />
                        <Typography color="text.secondary" align="center">
                          Add ad text to generate the preview
                        </Typography>
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={() => setLeftTab(1)}
                        >
                          Go to Ad Copy
                        </Button>
                      </Box>
                    );
                  }

                  // Video not ready (no metaVideoId)
                  if (isVideoWithoutMetaId) {
                    return (
                      <Box
                        sx={{
                          flex: 1,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexDirection: 'column',
                          gap: 2,
                          bgcolor: 'background.default',
                          border: '1px dashed',
                          borderColor: 'warning.main',
                          borderRadius: 1,
                          p: 4,
                          minHeight: 300,
                        }}
                      >
                        <HourglassIcon sx={{ fontSize: 48, color: 'warning.main' }} />
                        <Typography color="text.secondary" align="center">
                          The video is being processed by Meta.
                        </Typography>
                        <Typography variant="body2" color="text.secondary" align="center">
                          Meanwhile, you can preview with an image or wait for processing to complete.
                        </Typography>
                        {selectedImages.length > 0 && (
                          <Button
                            variant="outlined"
                            size="small"
                            onClick={() => {
                              // Find first image index in previewable assets
                              const imageIndex = previewableAssets.findIndex(a => a.type === 'image');
                              if (imageIndex >= 0) setPreviewAssetIndex(imageIndex);
                            }}
                          >
                            Preview with Image
                          </Button>
                        )}
                      </Box>
                    );
                  }

                  // Default fallback - show basic card preview
                  return (
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
                          {copies[previewVariant]?.headline || 'Ad title'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {copies[previewVariant]?.description || 'Preview will appear here'}
                        </Typography>
                      </CardContent>
                    </Card>
                  );
                })()
              )}
            </Box>

            <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
              {previewHtml
                ? 'Preview generated by Meta. Final appearance may vary.'
                : 'Approximate preview. Final appearance may vary by platform.'}
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
            Are you sure you don&apos;t want to use an optimized audience?
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
      {/* Add Funds Modal */}
      <Dialog
        open={addFundsOpen}
        onClose={() => {
          setAddFundsOpen(false);
          setFundError(null);
        }}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>Add Funds</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            Select an amount or enter a custom one. Minimum amount is $5.
          </Typography>
          <ToggleButtonGroup
            value={fundAmount}
            exclusive
            onChange={(_, value: number | null) => {
              setFundAmount(value);
              if (value) setFundCustomAmount('');
            }}
            sx={{ mb: 3, display: 'flex', flexWrap: 'wrap', gap: 1 }}
          >
            {[50, 100, 250, 500, 1000].map((amt) => (
              <ToggleButton key={amt} value={amt} sx={{
                  flex: '1 1 auto',
                  minWidth: 80,
                  '&.Mui-selected': {
                    backgroundColor: '#fdd835',
                    color: 'black',
                    '&:hover': { backgroundColor: '#fbc02d' },
                  },
                }}>
                ${amt}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <TextField
            fullWidth
            label="Custom amount"
            type="number"
            value={fundCustomAmount}
            onChange={(e) => {
              setFundCustomAmount(e.target.value);
              setFundAmount(null);
            }}
            slotProps={{
              input: { startAdornment: <Typography sx={{ mr: 1 }}>$</Typography> },
              htmlInput: { min: 5, step: 1 },
            }}
            helperText="Minimum $5 USD"
          />
          {fundError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {fundError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => { setAddFundsOpen(false); setFundError(null); }}>
            Cancel
          </Button>
          <Button
            variant="contained"
            disabled={fundLoading || ((fundAmount || parseFloat(fundCustomAmount) || 0) < 5)}
            onClick={async () => {
              const amt = fundAmount || parseFloat(fundCustomAmount) || 0;
              if (amt < 5) { setFundError('Minimum amount is $5'); return; }
              setFundLoading(true);
              setFundError(null);
              try {
                // Auto-save draft before redirecting to Stripe
                const savedDraftId = await saveDraft();
                const returnPath = savedDraftId
                  ? `/films/${film.id}/campaigns/new?draft=${savedDraftId}`
                  : `/films/${film.id}/campaigns/new`;

                const res = await fetch('/api/account/checkout', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ amount: amt, returnUrl: returnPath }),
                });
                if (!res.ok) {
                  const err = await res.json();
                  throw new Error(err.error || 'Error creating checkout session');
                }
                const { url } = await res.json();
                if (url) window.location.href = url;
              } catch (error) {
                setFundError(error instanceof Error ? error.message : 'Error processing payment');
              } finally {
                setFundLoading(false);
              }
            }}
          >
            {fundLoading ? (
              <CircularProgress size={24} color="inherit" />
            ) : (
              `Pay $${(fundAmount || parseFloat(fundCustomAmount) || 0).toFixed(2)} with Stripe`
            )}
          </Button>
        </DialogActions>
      </Dialog>

      {/* How it Works Modal */}
      <Dialog
        open={showHowItWorks}
        onClose={() => setShowHowItWorks(false)}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', textAlign: 'center' }}>
          <Box sx={{ flex: 1 }}>
            <Typography variant="h4" fontWeight="bold">How it Works</Typography>
          </Box>
          <IconButton onClick={() => setShowHowItWorks(false)}>
            <CloseIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ pt: 3 }}>
          <Grid container spacing={3}>
            {[
              {
                num: 1,
                title: 'Define your audience',
                body: 'Select your platforms (Instagram, Facebook, YouTube) and language, set your budget (min. $100), and schedule your campaign. Toggle "Pijama Audience" to leverage our optimized data, or manually segment by age and location.',
              },
              {
                num: 2,
                title: 'Ad creativity',
                body: 'We automatically generate 3 ad copy variants based on your movie metadata. Review and edit as needed. In digital marketing, it is always desirable to have multiple copy variations available.',
              },
              {
                num: 3,
                title: 'Visual Campaign Assets',
                body: 'Choose from your existing movie library (trailers, posters) or upload new assets. Please check dimension and length restrictions. High-performing social media assets often require different aspect ratios and shorter durations than standard film trailers.',
              },
              {
                num: 4,
                title: 'Review',
                body: 'Verify your budget, targeting, and creatives in a final summary. Once approved, we handle the technical distribution and delivery.',
              },
            ].map((step) => (
              <Grid key={step.num} size={{ xs: 12, sm: 6 }}>
                <Paper
                  variant="outlined"
                  sx={{ p: 3, height: '100%', borderRadius: 2, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}
                >
                  <Box
                    sx={{
                      width: 48,
                      height: 48,
                      borderRadius: '50%',
                      bgcolor: '#f5c518',
                      color: '#000',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 'bold',
                      fontSize: '1.25rem',
                      mb: 2,
                    }}
                  >
                    {step.num}
                  </Box>
                  <Typography variant="h6" fontWeight="bold" gutterBottom>
                    {step.title}
                  </Typography>
                  <Typography variant="body1" color="text.secondary">
                    {step.body}
                  </Typography>
                </Paper>
              </Grid>
            ))}
          </Grid>
        </DialogContent>
        <DialogActions sx={{ justifyContent: 'space-between', px: 3, py: 2 }}>
          <FormControlLabel
            control={
              <Checkbox
                checked={dontShowAgain}
                onChange={(e) => setDontShowAgain(e.target.checked)}
              />
            }
            label="Don't show this again"
          />
          <Button
            variant="contained"
            sx={{ bgcolor: '#f5c518', color: '#000', '&:hover': { bgcolor: '#e0b015' } }}
            onClick={() => {
              setShowHowItWorks(false);
              if (dontShowAgain) {
                fetch('/api/user-preferences/how-it-works', { method: 'PATCH' });
              }
            }}
          >
            Get Started
          </Button>
        </DialogActions>
      </Dialog>
    </Container>
  );
}
