'use client';

import { Box, Typography, Paper, Chip } from '@mui/material';
import {
  PlayArrow as PlayArrowIcon,
  SkipNext as SkipNextIcon,
  SmartDisplay as SmartDisplayIcon,
} from '@mui/icons-material';

type YouTubeAdPreviewProps = {
  adFormat: string;
  headline?: string;
  description?: string;
  thumbnailUrl?: string;
  callToAction?: string;
  channelName?: string;
};

export default function YouTubeAdPreview({
  adFormat,
  headline = 'Titulo del anuncio',
  description = 'Descripcion del anuncio',
  thumbnailUrl,
  callToAction = 'Ver mas',
  channelName = 'Tu Canal',
}: YouTubeAdPreviewProps) {
  const renderInStreamPreview = (skippable: boolean) => (
    <Box sx={{ position: 'relative', width: '100%', maxWidth: 480 }}>
      {/* Video area */}
      <Box
        sx={{
          width: '100%',
          aspectRatio: '16/9',
          bgcolor: 'grey.900',
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {thumbnailUrl ? (
          <Box
            component="img"
            src={thumbnailUrl}
            alt="Preview"
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <PlayArrowIcon sx={{ fontSize: 64, color: 'white', opacity: 0.7 }} />
        )}

        {/* Ad badge */}
        <Chip
          label="Anuncio"
          size="small"
          sx={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            bgcolor: 'rgba(255,204,0,0.9)',
            color: 'black',
            fontWeight: 'bold',
            fontSize: '0.7rem',
          }}
        />

        {/* Skip button */}
        {skippable && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 8,
              right: 8,
              bgcolor: 'rgba(0,0,0,0.7)',
              color: 'white',
              px: 1.5,
              py: 0.5,
              borderRadius: 1,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              fontSize: '0.8rem',
            }}
          >
            <Typography variant="caption" sx={{ color: 'white' }}>
              Saltar anuncio
            </Typography>
            <SkipNextIcon sx={{ fontSize: 16 }} />
          </Box>
        )}

        {/* CTA overlay */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 48,
            right: 8,
            bgcolor: 'primary.main',
            color: 'white',
            px: 2,
            py: 0.5,
            borderRadius: 1,
            fontSize: '0.8rem',
            fontWeight: 'bold',
          }}
        >
          {callToAction}
        </Box>
      </Box>

      {/* Headline below video */}
      <Box sx={{ mt: 1, px: 0.5 }}>
        <Typography variant="body2" fontWeight="medium" noWrap>
          {headline}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {channelName}
        </Typography>
      </Box>
    </Box>
  );

  const renderInFeedPreview = () => (
    <Box sx={{ display: 'flex', gap: 1.5, maxWidth: 480 }}>
      {/* Thumbnail */}
      <Box
        sx={{
          width: 168,
          height: 94,
          bgcolor: 'grey.800',
          borderRadius: 1,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {thumbnailUrl ? (
          <Box
            component="img"
            src={thumbnailUrl}
            alt="Preview"
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <SmartDisplayIcon sx={{ fontSize: 40, color: 'white', opacity: 0.7 }} />
        )}
        <Chip
          label="Anuncio"
          size="small"
          sx={{
            position: 'absolute',
            bottom: 4,
            left: 4,
            bgcolor: 'rgba(255,204,0,0.9)',
            color: 'black',
            fontWeight: 'bold',
            fontSize: '0.6rem',
            height: 18,
          }}
        />
      </Box>

      {/* Info */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" fontWeight="medium" sx={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
        }}>
          {headline}
        </Typography>
        <Typography variant="caption" color="text.secondary" display="block">
          {channelName}
        </Typography>
        <Typography variant="caption" color="text.secondary" noWrap>
          {description}
        </Typography>
      </Box>
    </Box>
  );

  const renderBumperPreview = () => (
    <Box sx={{ position: 'relative', width: '100%', maxWidth: 480 }}>
      <Box
        sx={{
          width: '100%',
          aspectRatio: '16/9',
          bgcolor: 'grey.900',
          borderRadius: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        {thumbnailUrl ? (
          <Box
            component="img"
            src={thumbnailUrl}
            alt="Preview"
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <PlayArrowIcon sx={{ fontSize: 64, color: 'white', opacity: 0.7 }} />
        )}

        <Chip
          label="Anuncio"
          size="small"
          sx={{
            position: 'absolute',
            bottom: 8,
            left: 8,
            bgcolor: 'rgba(255,204,0,0.9)',
            color: 'black',
            fontWeight: 'bold',
            fontSize: '0.7rem',
          }}
        />

        {/* Timer */}
        <Box
          sx={{
            position: 'absolute',
            bottom: 8,
            right: 8,
            bgcolor: 'rgba(0,0,0,0.7)',
            color: 'white',
            px: 1.5,
            py: 0.5,
            borderRadius: 1,
            fontSize: '0.8rem',
          }}
        >
          0:06
        </Box>
      </Box>
    </Box>
  );

  const renderShortsPreview = () => (
    <Box
      sx={{
        width: 200,
        height: 356,
        bgcolor: 'grey.900',
        borderRadius: 2,
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        overflow: 'hidden',
        border: '2px solid',
        borderColor: 'grey.700',
      }}
    >
      {/* Video area */}
      <Box
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {thumbnailUrl ? (
          <Box
            component="img"
            src={thumbnailUrl}
            alt="Preview"
            sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <PlayArrowIcon sx={{ fontSize: 48, color: 'white', opacity: 0.7 }} />
        )}
      </Box>

      {/* CTA overlay at bottom */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          p: 1.5,
          background: 'linear-gradient(transparent, rgba(0,0,0,0.8))',
        }}
      >
        <Chip
          label="Anuncio"
          size="small"
          sx={{
            bgcolor: 'rgba(255,204,0,0.9)',
            color: 'black',
            fontWeight: 'bold',
            fontSize: '0.6rem',
            height: 18,
            mb: 0.5,
          }}
        />
        <Typography variant="caption" sx={{ color: 'white', display: 'block' }} noWrap>
          {headline}
        </Typography>
        <Box
          sx={{
            bgcolor: 'primary.main',
            color: 'white',
            px: 1.5,
            py: 0.3,
            borderRadius: 1,
            mt: 0.5,
            textAlign: 'center',
            fontSize: '0.7rem',
            fontWeight: 'bold',
          }}
        >
          {callToAction}
        </Box>
      </Box>
    </Box>
  );

  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2, alignSelf: 'flex-start' }}>
        Vista previa - {getFormatLabel(adFormat)}
      </Typography>

      {adFormat === 'IN_STREAM_SKIPPABLE' && renderInStreamPreview(true)}
      {adFormat === 'IN_STREAM_NON_SKIPPABLE' && renderInStreamPreview(false)}
      {adFormat === 'IN_FEED' && renderInFeedPreview()}
      {adFormat === 'BUMPER' && renderBumperPreview()}
      {adFormat === 'SHORTS' && renderShortsPreview()}
    </Paper>
  );
}

function getFormatLabel(format: string): string {
  switch (format) {
    case 'IN_STREAM_SKIPPABLE':
      return 'In-Stream (Saltable)';
    case 'IN_STREAM_NON_SKIPPABLE':
      return 'In-Stream (No Saltable)';
    case 'IN_FEED':
      return 'In-Feed';
    case 'BUMPER':
      return 'Bumper (6s)';
    case 'SHORTS':
      return 'Shorts';
    default:
      return format;
  }
}
