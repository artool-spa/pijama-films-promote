'use client';

import { useState, useRef, useCallback, useMemo } from 'react';
import ReactCrop, { type Crop, type PixelCrop } from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  ToggleButtonGroup,
  ToggleButton,
  Box,
  Typography,
  CircularProgress,
  Alert,
} from '@mui/material';
import { CROP_ASPECT_RATIOS } from '@/lib/assets/formats';
import { META_IMAGE_REQUIREMENTS } from '@/lib/assets/validation';
import type { ImageWithUsage } from '@/models/image';

type CropDialogProps = {
  open: boolean;
  image: ImageWithUsage;
  filmMuviUuid: string;
  onClose: () => void;
  onCropComplete: (newImage: ImageWithUsage) => void;
};

// Map aspect ratio value to display string
function ratioToString(ratio: number): string {
  if (ratio === 9 / 16) return '9:16';
  if (ratio === 16 / 9) return '16:9';
  if (ratio === 4 / 5) return '4:5';
  if (ratio === 1) return '1:1';
  return `${ratio}`;
}

/**
 * Calculate an initial crop (in displayed px) that:
 *  1. Maintains the requested aspect ratio
 *  2. Is as large as possible (up to 80% of the displayed image)
 *  3. Never produces real-pixel output below the minimum requirements
 *
 * Returns null if the source image is too small to produce a valid crop.
 */
function calcInitialCrop(
  displayedWidth: number,
  displayedHeight: number,
  naturalWidth: number,
  naturalHeight: number,
  aspectRatio: number,
): Crop | null {
  const scaleX = naturalWidth / displayedWidth;
  const scaleY = naturalHeight / displayedHeight;

  const minW = META_IMAGE_REQUIREMENTS.minWidth;
  const minH = META_IMAGE_REQUIREMENTS.minHeight;

  // Minimum displayed crop size that satisfies real-pixel minimums
  // Given aspect ratio r: cropW = cropH * r
  // Real pixels: cropH * scaleY >= minH  AND  cropH * r * scaleX >= minW
  const minCropH = Math.max(minH / scaleY, minW / (aspectRatio * scaleX));
  const minCropW = minCropH * aspectRatio;

  // If the minimum doesn't fit in the displayed image, the source is too small
  if (minCropW > displayedWidth || minCropH > displayedHeight) return null;

  // Target 80% of the image, but no smaller than the minimum
  let cropHeight: number;
  let cropWidth: number;

  if (displayedWidth / displayedHeight > aspectRatio) {
    cropHeight = Math.max(displayedHeight * 0.8, minCropH);
    cropWidth = cropHeight * aspectRatio;
  } else {
    cropWidth = Math.max(displayedWidth * 0.8, minCropW);
    cropHeight = cropWidth / aspectRatio;
  }

  // Clamp to image bounds
  cropWidth = Math.min(cropWidth, displayedWidth);
  cropHeight = Math.min(cropHeight, displayedHeight);

  return {
    unit: 'px',
    x: (displayedWidth - cropWidth) / 2,
    y: (displayedHeight - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

export default function CropDialog({ open, image, filmMuviUuid, onClose, onCropComplete }: CropDialogProps) {
  const [selectedRatio, setSelectedRatio] = useState<number>(CROP_ASPECT_RATIOS[0].value);
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<PixelCrop>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceTooSmall, setSourceTooSmall] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Compute real pixel dimensions of the current crop selection
  const realPixelCrop = useMemo(() => {
    if (!completedCrop || !imgRef.current) return null;
    const img = imgRef.current;
    const scaleX = img.naturalWidth / img.width;
    const scaleY = img.naturalHeight / img.height;
    return {
      width: Math.round(completedCrop.width * scaleX),
      height: Math.round(completedCrop.height * scaleY),
    };
  }, [completedCrop]);

  const isCropTooSmall = realPixelCrop !== null && (
    realPixelCrop.width < META_IMAGE_REQUIREMENTS.minWidth ||
    realPixelCrop.height < META_IMAGE_REQUIREMENTS.minHeight
  );

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const el = e.currentTarget;
      const initial = calcInitialCrop(
        el.width, el.height, el.naturalWidth, el.naturalHeight, selectedRatio,
      );
      setSourceTooSmall(initial === null);
      if (initial) setCrop(initial);
    },
    [selectedRatio]
  );

  const handleRatioChange = (_: React.MouseEvent<HTMLElement>, newRatio: number | null) => {
    if (newRatio === null) return;
    setSelectedRatio(newRatio);

    if (imgRef.current) {
      const el = imgRef.current;
      const initial = calcInitialCrop(
        el.width, el.height, el.naturalWidth, el.naturalHeight, newRatio,
      );
      setSourceTooSmall(initial === null);
      if (initial) {
        setCrop(initial);
      }
      setCompletedCrop(undefined);
    }
  };

  const handleSave = async () => {
    if (!completedCrop || !imgRef.current) return;

    setSaving(true);
    setError(null);

    try {
      // Calculate actual pixel coordinates from the displayed image
      const displayedImg = imgRef.current;
      const scaleX = displayedImg.naturalWidth / displayedImg.width;
      const scaleY = displayedImg.naturalHeight / displayedImg.height;

      const pixelCrop = {
        x: Math.round(completedCrop.x * scaleX),
        y: Math.round(completedCrop.y * scaleY),
        width: Math.round(completedCrop.width * scaleX),
        height: Math.round(completedCrop.height * scaleY),
      };

      const res = await fetch('/api/assets/crop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          imageId: image.id,
          filmMuviUuid,
          crop: pixelCrop,
          targetAspectRatio: ratioToString(selectedRatio),
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to crop image');
      }

      const result = await res.json();

      // Create the new image object with usage count
      const newImage: ImageWithUsage = {
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

      onCropComplete(newImage);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to crop image');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Crop Image</DialogTitle>
      <DialogContent>
        {/* Aspect ratio selector */}
        <Box sx={{ mb: 2 }}>
          <Typography variant="subtitle2" gutterBottom>
            Aspect Ratio
          </Typography>
          <ToggleButtonGroup
            value={selectedRatio}
            exclusive
            onChange={handleRatioChange}
            size="small"
          >
            {CROP_ASPECT_RATIOS.map((ratio) => (
              <ToggleButton key={ratio.label} value={ratio.value}>
                {ratio.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {/* Source too small for this ratio */}
        {sourceTooSmall && (
          <Alert severity="error" sx={{ mb: 2 }}>
            This image is too small to crop at this aspect ratio. Minimum output is {META_IMAGE_REQUIREMENTS.minWidth}x{META_IMAGE_REQUIREMENTS.minHeight}px.
          </Alert>
        )}

        {/* Dimension info and minimum size warning */}
        {realPixelCrop && !sourceTooSmall && (
          <Box sx={{ mb: 1.5, display: 'flex', alignItems: 'center', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              Crop size: {realPixelCrop.width} x {realPixelCrop.height}px
            </Typography>
            {isCropTooSmall && (
              <Alert severity="error" sx={{ py: 0, flex: 1 }}>
                Too small. Minimum is {META_IMAGE_REQUIREMENTS.minWidth}x{META_IMAGE_REQUIREMENTS.minHeight}px.
              </Alert>
            )}
          </Box>
        )}

        {/* Crop area */}
        <Box sx={{ display: 'flex', justifyContent: 'center', maxHeight: '60vh', overflow: 'auto' }}>
          <ReactCrop
            crop={crop}
            onChange={(c) => setCrop(c)}
            onComplete={(c) => setCompletedCrop(c)}
            aspect={selectedRatio}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imgRef}
              src={image.url}
              alt={image.name}
              onLoad={onImageLoad}
              style={{ maxWidth: '100%', maxHeight: '60vh' }}
            />
          </ReactCrop>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          onClick={handleSave}
          disabled={saving || !completedCrop || isCropTooSmall || sourceTooSmall}
          startIcon={saving ? <CircularProgress size={16} /> : undefined}
        >
          {saving ? 'Saving...' : 'Crop & Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
