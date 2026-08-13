'use client';

import { Alert, AlertTitle, Box, Button, Stack } from '@mui/material';
import type { CampaignStateExplanation } from '@/lib/campaigns/status-explainer';

export type CampaignStatusCardProps = {
  state: CampaignStateExplanation;
  onAction?: (key: string) => void;
};

/**
 * Renders a human-readable explanation of the campaign's current state.
 * Feeds off `explainCampaignState` to describe pending review, mixed approval,
 * sync errors, etc.
 */
export default function CampaignStatusCard({ state, onAction }: CampaignStatusCardProps) {
  return (
    <Alert
      severity={state.tone}
      sx={{ mb: 3 }}
      action={
        state.actions.length > 0 && onAction ? (
          <Stack direction="row" spacing={1}>
            {state.actions.map((action) => (
              <Button
                key={action.onClickKey ?? action.label}
                color="inherit"
                size="small"
                onClick={() => action.onClickKey && onAction(action.onClickKey)}
                href={action.href}
              >
                {action.label}
              </Button>
            ))}
          </Stack>
        ) : null
      }
    >
      <AlertTitle>{state.title}</AlertTitle>
      <Box>{state.description}</Box>
    </Alert>
  );
}
