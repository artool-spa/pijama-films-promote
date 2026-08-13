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
  Link,
  Snackbar,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { ArrowBack as ArrowBackIcon } from '@mui/icons-material';
import type { Film } from '@/models/film';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';

export type CampaignEditClientProps = {
  film: Film;
  campaign: CampaignWithPartnerAndAds;
};

export default function CampaignEditClient({ film, campaign }: CampaignEditClientProps) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [budget, setBudget] = useState<string>(String(campaign.budget));
  const [endDate, setEndDate] = useState<string>(
    campaign.endDate ? new Date(campaign.endDate).toISOString().slice(0, 10) : ''
  );
  const [snack, setSnack] = useState<{ message: string; severity: 'success' | 'error' | 'warning' } | null>(null);
  const backHref = `/films/${film.id}/campaigns/${campaign.id}`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      const budgetNumber = Number(budget);
      if (!Number.isNaN(budgetNumber) && budgetNumber > 0 && budgetNumber !== campaign.budget) {
        payload.budget = budgetNumber;
      }
      if (endDate) {
        const parsed = new Date(endDate);
        if (!campaign.endDate || parsed.getTime() !== new Date(campaign.endDate).getTime()) {
          payload.endDate = parsed.toISOString();
        }
      }

      if (Object.keys(payload).length === 0) {
        setSnack({ message: 'No changes to save', severity: 'warning' });
        return;
      }

      const res = await fetch(`/api/meta/campaigns/${campaign.id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
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
        setSnack({ message: 'Campaign updated', severity: 'success' });
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
    <Container maxWidth="md" sx={{ py: 4 }}>
      <Breadcrumbs sx={{ mb: 1 }}>
        <Link underline="hover" color="inherit" href={`/films/${film.id}/campaigns`}>
          {film.title}
        </Link>
        <Link underline="hover" color="inherit" href={backHref}>
          {campaign.name}
        </Link>
        <Typography color="text.primary">Edit</Typography>
      </Breadcrumbs>

      <Button startIcon={<ArrowBackIcon />} onClick={() => router.push(backHref)} sx={{ mb: 1 }}>
        Back to campaign
      </Button>

      <Typography variant="h4" component="h1" gutterBottom>
        Edit campaign
      </Typography>
      <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
        {campaign.name}
      </Typography>

      <Alert severity="info" sx={{ mb: 3 }}>
        Only budget and end date can be edited on a live campaign. Start date, targeting and
        creative content are locked once the campaign has been submitted to the platforms.
      </Alert>

      <Card>
        <CardContent>
          <Box component="form" onSubmit={handleSubmit}>
            <Stack spacing={3}>
              <TextField
                label={`Budget (${campaign.budgetType === 'DAILY' ? 'daily' : 'lifetime'}, USD)`}
                type="number"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                inputProps={{ min: 0.01, step: 0.01 }}
                required
                helperText={`Currently: $${campaign.budget}`}
              />

              <TextField
                label="End date"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                InputLabelProps={{ shrink: true }}
                helperText={
                  campaign.endDate
                    ? `Currently: ${new Date(campaign.endDate).toISOString().slice(0, 10)}`
                    : 'Currently: no end date'
                }
              />

              <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
                <Button onClick={() => router.push(backHref)} disabled={submitting}>
                  Cancel
                </Button>
                <Button type="submit" variant="contained" color="primary" disabled={submitting}>
                  {submitting ? 'Saving...' : 'Save changes'}
                </Button>
              </Box>
            </Stack>
          </Box>
        </CardContent>
      </Card>

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
