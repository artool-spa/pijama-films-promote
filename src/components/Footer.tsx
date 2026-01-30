'use client';

import { Box, Container, Typography, Link as MuiLink } from '@mui/material';
import NextLink from 'next/link';

export default function Footer() {
  const currentYear = new Date().getFullYear();

  return (
    <Box
      component="footer"
      sx={{
        py: 3,
        px: 2,
        mt: 'auto',
        backgroundColor: (theme) =>
          theme.palette.mode === 'light' ? theme.palette.grey[100] : theme.palette.grey[900],
      }}
    >
      <Container maxWidth="lg">
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', sm: 'row' },
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <Typography variant="body2" color="text.secondary">
            © {currentYear} Pijama Films. All rights reserved.
          </Typography>
          <Box
            sx={{
              display: 'flex',
              gap: 3,
            }}
          >
            <MuiLink
              component={NextLink}
              href="/privacy-policy"
              variant="body2"
              color="text.secondary"
              underline="hover"
            >
              Privacy Policy
            </MuiLink>
            <MuiLink
              component={NextLink}
              href="/terms-of-service"
              variant="body2"
              color="text.secondary"
              underline="hover"
            >
              Terms of Service
            </MuiLink>
          </Box>
        </Box>
      </Container>
    </Box>
  );
}
