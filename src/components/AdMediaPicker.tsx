'use client';

import {
  Box,
  Button,
  Card,
  CardMedia,
  Checkbox,
  Chip,
  Tooltip,
  Typography,
} from '@mui/material';
import {
  Image as ImageIcon,
  OpenInNew as OpenInNewIcon,
  Warning as WarningIcon,
} from '@mui/icons-material';
import type { AssetStatus } from '@/lib/assets/status';
import { ASSET_STATUS_COLORS, ASSET_STATUS_LABELS } from '@/lib/assets/labels';
import { getAspectRatioLabel } from '@/lib/assets/formats';

/**
 * One selectable asset. Deliberately free of model types so the picker stays
 * usable from anywhere: callers map their own images/videos onto this shape.
 */
export type PickerAsset = {
  id: string;
  name: string;
  /** The image URL, or a video's thumbnail. */
  thumbnailUrl: string | null;
  status: AssetStatus;
  aspectRatio: string | null;
  usedInAds: number;
  /** Non-null blocks *selecting* the asset, and is shown as a tooltip. */
  disabledReason: string | null;
  /** Advisory only — shown as a warning icon, does not block selection. */
  warning: string | null;
};

export type AdMediaPickerProps = {
  label: string;
  assets: PickerAsset[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  max: number;
  readOnly?: boolean;
  error?: string;
  emptyMessage: string;
  /** Link to the film's asset library, for uploading something new. */
  manageHref?: string;
};

export default function AdMediaPicker({
  label,
  assets,
  selectedIds,
  onChange,
  max,
  readOnly = false,
  error,
  emptyMessage,
  manageHref,
}: AdMediaPickerProps) {
  const atCap = selectedIds.length >= max;

  const toggle = (id: string, checked: boolean) => {
    // Append-only: the parent diffs the selection by index, so re-deriving the
    // order from the library would fake a change and burn a review cycle.
    onChange(checked ? [...selectedIds, id] : selectedIds.filter((value) => value !== id));
  };

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
        <Typography variant="subtitle2">{label}</Typography>
        <Typography
          variant="caption"
          color={atCap ? 'warning.main' : 'text.secondary'}
          sx={{ flexGrow: 1 }}
        >
          {selectedIds.length} of {max} selected
        </Typography>
        {manageHref && (
          <Button size="small" endIcon={<OpenInNewIcon />} href={manageHref}>
            Manage assets
          </Button>
        )}
      </Box>

      {assets.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
          {emptyMessage}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {assets.map((asset) => {
            const isSelected = selectedIds.includes(asset.id);
            // Asymmetric on purpose: an asset that became unusable can always
            // be removed, it just cannot be picked again.
            const disabled = readOnly || (!isSelected && (atCap || !!asset.disabledReason));

            const card = (
              <Card
                data-testid={`asset-${asset.id}`}
                sx={{
                  width: 140,
                  position: 'relative',
                  border: isSelected ? '2px solid' : '1px solid',
                  borderColor: isSelected ? 'primary.main' : 'divider',
                  opacity: asset.disabledReason && !isSelected ? 0.5 : 1,
                }}
              >
                <Box sx={{ position: 'absolute', top: 2, left: 2, zIndex: 2 }}>
                  <Checkbox
                    size="small"
                    checked={isSelected}
                    disabled={disabled}
                    inputProps={{ 'aria-label': asset.name }}
                    onChange={(e) => toggle(asset.id, e.target.checked)}
                    sx={{
                      bgcolor: 'rgba(255,255,255,0.8)',
                      borderRadius: 1,
                      p: 0.25,
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.9)' },
                    }}
                  />
                </Box>

                <Chip
                  label={ASSET_STATUS_LABELS[asset.status]}
                  size="small"
                  color={ASSET_STATUS_COLORS[asset.status]}
                  sx={{ position: 'absolute', top: 2, right: 2, zIndex: 2, height: 18, fontSize: 10 }}
                />

                {asset.thumbnailUrl ? (
                  <CardMedia
                    component="img"
                    height="75"
                    image={asset.thumbnailUrl}
                    alt={asset.name}
                    sx={{ objectFit: 'cover' }}
                  />
                ) : (
                  <Box
                    sx={{
                      height: 75,
                      bgcolor: 'grey.200',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <ImageIcon sx={{ color: 'grey.500' }} />
                  </Box>
                )}

                <Box sx={{ p: 1 }}>
                  <Typography variant="caption" noWrap display="block" title={asset.name}>
                    {asset.name}
                  </Typography>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                    <Typography variant="caption" color="text.secondary" sx={{ flexGrow: 1 }}>
                      {getAspectRatioLabel(asset.aspectRatio)}
                    </Typography>
                    {asset.warning && (
                      <Tooltip title={asset.warning}>
                        <WarningIcon sx={{ fontSize: 14, color: 'warning.main' }} />
                      </Tooltip>
                    )}
                  </Box>
                </Box>
              </Card>
            );

            return asset.disabledReason ? (
              <Tooltip key={asset.id} title={asset.disabledReason}>
                {/* A span keeps the tooltip working over a disabled control. */}
                <span>{card}</span>
              </Tooltip>
            ) : (
              <Box key={asset.id}>{card}</Box>
            );
          })}
        </Box>
      )}

      {error && (
        <Typography variant="caption" color="error" display="block" sx={{ mt: 1 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
