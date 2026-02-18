'use client';

import { Box, Typography, Paper, Chip, Button } from '@mui/material';
import { Image as ImageIcon } from '@mui/icons-material';

type GoogleDisplayAdPreviewProps = {
  headline?: string;
  description?: string;
  imageUrl?: string;
  callToAction?: string;
  businessName?: string;
};

export default function GoogleDisplayAdPreview({
  headline = 'Titulo del anuncio',
  description = 'Descripcion del anuncio',
  imageUrl,
  callToAction = 'Ver mas',
  businessName = 'Tu Marca',
}: GoogleDisplayAdPreviewProps) {
  return (
    <Paper
      variant="outlined"
      sx={{ p: 2, display: 'flex', flexDirection: 'column', alignItems: 'center' }}
    >
      <Typography variant="subtitle2" color="text.secondary" sx={{ mb: 2, alignSelf: 'flex-start' }}>
        Vista previa - Google Demand Gen
      </Typography>

      <Box sx={{ width: '100%', maxWidth: 400 }}>
        {/* Image area */}
        <Box
          sx={{
            width: '100%',
            aspectRatio: '1.91/1',
            bgcolor: 'grey.100',
            borderRadius: '8px 8px 0 0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {imageUrl ? (
            <Box
              component="img"
              src={imageUrl}
              alt="Preview"
              sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
            />
          ) : (
            <ImageIcon sx={{ fontSize: 64, color: 'grey.400' }} />
          )}

          {/* Ad badge */}
          <Chip
            label="Anuncio"
            size="small"
            sx={{
              position: 'absolute',
              top: 8,
              left: 8,
              bgcolor: 'rgba(255,204,0,0.9)',
              color: 'black',
              fontWeight: 'bold',
              fontSize: '0.7rem',
            }}
          />
        </Box>

        {/* Content area */}
        <Box
          sx={{
            border: '1px solid',
            borderColor: 'divider',
            borderTop: 'none',
            borderRadius: '0 0 8px 8px',
            p: 2,
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ mb: 0.5, display: 'block' }}>
            {businessName}
          </Typography>
          <Typography
            variant="body1"
            fontWeight="bold"
            sx={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              mb: 0.5,
            }}
          >
            {headline}
          </Typography>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              mb: 1.5,
            }}
          >
            {description}
          </Typography>
          <Button
            variant="contained"
            size="small"
            fullWidth
            sx={{
              textTransform: 'none',
              fontWeight: 'bold',
            }}
          >
            {callToAction}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
}
