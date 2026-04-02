import { headers } from 'next/headers';
import logger from '@/lib/logger';
import { Box, Typography, Button } from '@mui/material';

export default async function NotFound() {
  const headersList = await headers();
  const path = headersList.get('x-request-path') || 'unknown';
  const method = headersList.get('x-request-method') || 'GET';

  logger.warn({ method, path, status: 404 }, 'Not found');

  return (
    <Box
      display="flex"
      flexDirection="column"
      alignItems="center"
      justifyContent="center"
      minHeight="60vh"
      gap={2}
    >
      <Typography variant="h3" fontWeight="bold">
        404
      </Typography>
      <Typography variant="h6" color="text.secondary">
        Page not found
      </Typography>
      <Button href="/" variant="contained" sx={{ mt: 2 }}>
        Home
      </Button>
    </Box>
  );
}
