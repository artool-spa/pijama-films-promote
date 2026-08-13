'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  Box,
  Breadcrumbs,
  Button,
  Card,
  CardContent,
  Container,
  Grid,
  Link,
  Snackbar,
  Typography,
} from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import AdEditForm, { type AdEditFormValues } from '@/components/AdEditForm';
import GoogleDisplayAdPreview from '@/components/GoogleDisplayAdPreview';
import type { Film } from '@/models/film';
import type { AdWithCampaignAndPartner } from '@/models/ad';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';

export type AdEditClientProps = {
  film: Film;
  campaign: CampaignWithPartnerAndAds;
  ad: AdWithCampaignAndPartner;
};

export default function AdEditClient({ film, campaign, ad }: AdEditClientProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] = useState<AdEditFormValues>({
    headlines: ad.headlines,
    bodies: ad.bodies,
    descriptions: ad.descriptions,
    callToAction: ad.callToAction,
    linkUrl: ad.linkUrl,
  });
  const [snack, setSnack] = useState<{ message: string; severity: 'success' | 'error' | 'warning' } | null>(null);

  const platform: 'META' | 'GOOGLE' | null = ad.metaAdId ? 'META' : ad.googleAdId ? 'GOOGLE' : null;
  const backHref = `/films/${film.id}/campaigns/${campaign.id}/ads`;

  const handleSubmit = async (values: AdEditFormValues) => {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/meta/ads/${ad.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to save changes');
      }

      const data = (await res.json()) as { warnings?: string[] };
      if (data.warnings && data.warnings.length > 0) {
        setSnack({
          message: `Saved locally. Platform push had issues: ${data.warnings.join('; ')}`,
          severity: 'warning',
        });
      } else {
        setSnack({
          message: platform
            ? `Changes saved. ${platform === 'META' ? 'Meta' : 'Google'} will review the ad again.`
            : 'Changes saved.',
          severity: 'success',
        });
      }

      setTimeout(() => router.push(backHref), 1200);
    } catch (err) {
      setSnack({
        message: err instanceof Error ? err.message : 'Failed to save changes',
        severity: 'error',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Container maxWidth="xl" sx={{ py: 4 }}>
      <Box sx={{ mb: 3 }}>
        <Breadcrumbs sx={{ mb: 1 }}>
          <Link underline="hover" color="inherit" href={`/films/${film.id}/campaigns`}>
            {film.title}
          </Link>
          <Link underline="hover" color="inherit" href={`/films/${film.id}/campaigns/${campaign.id}`}>
            {campaign.name}
          </Link>
          <Link underline="hover" color="inherit" href={backHref}>
            Ads
          </Link>
          <Typography color="text.primary">Edit</Typography>
        </Breadcrumbs>

        <Button startIcon={<ArrowBackIcon />} onClick={() => router.push(backHref)} sx={{ mb: 1 }}>
          Back to ads
        </Button>

        <Typography variant="h4" component="h1" gutterBottom>
          Edit ad
        </Typography>
        <Typography variant="body1" color="text.secondary">
          {ad.name}
        </Typography>
      </Box>

      {platform && (
        <Alert severity="info" sx={{ mb: 3 }}>
          Changes will replace the current creative on {platform === 'META' ? 'Meta' : 'Google Ads'}
          . The ad will re-enter platform review after saving.
        </Alert>
      )}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, md: 7 }}>
          <Card>
            <CardContent>
              <AdEditForm
                initial={{
                  headlines: ad.headlines,
                  bodies: ad.bodies,
                  descriptions: ad.descriptions,
                  callToAction: ad.callToAction,
                  linkUrl: ad.linkUrl,
                }}
                onSubmit={async (values) => {
                  setPreview(values);
                  await handleSubmit(values);
                }}
                onCancel={() => router.push(backHref)}
                submitting={submitting}
              />
            </CardContent>
          </Card>
        </Grid>

        <Grid size={{ xs: 12, md: 5 }}>
          <Card variant="outlined" sx={{ position: 'sticky', top: 16 }}>
            <CardContent>
              <Typography variant="subtitle1" gutterBottom>
                Preview
              </Typography>
              <GoogleDisplayAdPreview
                headline={preview.headlines[0] || ad.headlines[0]}
                description={preview.descriptions[0] || preview.bodies[0] || ad.bodies[0]}
                imageUrl={ad.images[0]?.url}
                callToAction={preview.callToAction}
                businessName={campaign.partner.name}
              />
              <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 2 }}>
                This is an approximate preview. The final render on each platform may differ.
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Snackbar
        open={!!snack}
        autoHideDuration={5000}
        onClose={() => setSnack(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        {snack ? (
          <Alert severity={snack.severity} onClose={() => setSnack(null)} sx={{ width: '100%' }}>
            {snack.message}
          </Alert>
        ) : undefined}
      </Snackbar>
    </Container>
  );
}
