'use client';

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Alert,
  Chip,
  Divider,
  List,
  ListItem,
  ListItemText,
  CircularProgress,
} from '@mui/material';
import { Warning as WarningIcon, Edit as EditIcon, Refresh as RefreshIcon } from '@mui/icons-material';
import { useState } from 'react';
import type { AdApprovalStatus } from '@/lib/campaigns/approval-status';
import { normalizeApprovalStatus } from '@/lib/campaigns/approval-status';

type PolicyTopic = {
  title: string;
  reason: string;
  suggestions: string[];
  helpUrl?: string;
};

export type RejectionDetailsDialogProps = {
  open: boolean;
  onClose: () => void;
  adId: string;
  adName: string;
  platform: 'META' | 'GOOGLE' | null;
  approvalStatus: AdApprovalStatus;
  rejectionReason: string | null;
  suggestedCorrection: string | null;
  rejectionDetails: unknown | null;
  onEdit: () => void;
  onRefresh?: () => Promise<void>;
};

export default function RejectionDetailsDialog({
  open,
  onClose,
  adName,
  platform,
  approvalStatus,
  rejectionReason,
  suggestedCorrection,
  rejectionDetails,
  onEdit,
  onRefresh,
}: RejectionDetailsDialogProps) {
  const [refreshing, setRefreshing] = useState(false);
  const approval = normalizeApprovalStatus(approvalStatus);

  const topics: PolicyTopic[] = Array.isArray(
    (rejectionDetails as { policyTopics?: PolicyTopic[] } | null)?.policyTopics
  )
    ? ((rejectionDetails as { policyTopics: PolicyTopic[] }).policyTopics as PolicyTopic[])
    : [];

  const receivedAt =
    (rejectionDetails as { receivedAt?: string } | null)?.receivedAt ?? null;

  const handleRefresh = async () => {
    if (!onRefresh) return;
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <WarningIcon color="warning" />
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h6" component="div">
            Review details
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {adName}
          </Typography>
        </Box>
        <Chip label={approval.label} color={approval.color} size="small" />
      </DialogTitle>

      <DialogContent dividers>
        {platform && (
          <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 2 }}>
            Platform: {platform === 'META' ? 'Meta' : 'Google Ads'}
            {receivedAt ? ` — last checked ${new Date(receivedAt).toLocaleString()}` : ''}
          </Typography>
        )}

        {approvalStatus === 'UNKNOWN' && (
          <Alert severity="info" sx={{ mb: 2 }}>
            The platform has not returned a review result yet. Click &quot;Refresh from platform&quot; to force
            a check.
          </Alert>
        )}

        {rejectionReason && (
          <>
            <Typography variant="subtitle1" gutterBottom fontWeight="medium">
              Why was it rejected?
            </Typography>
            <Alert severity={approvalStatus === 'DISAPPROVED' ? 'error' : 'warning'} sx={{ mb: 2 }}>
              {rejectionReason}
            </Alert>
          </>
        )}

        {topics.length > 0 && (
          <>
            <Typography variant="subtitle2" gutterBottom sx={{ mt: 2 }}>
              Policy topics
            </Typography>
            <List dense>
              {topics.map((topic, i) => (
                <ListItem key={i} sx={{ display: 'block', pl: 0 }}>
                  <ListItemText
                    primary={<Typography variant="body2" fontWeight="medium">{topic.title}</Typography>}
                    secondary={
                      <Box component="span">
                        <Typography variant="body2" color="text.secondary">
                          {topic.reason}
                        </Typography>
                        {topic.helpUrl && (
                          <Typography
                            variant="caption"
                            component="a"
                            href={topic.helpUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{ display: 'block', mt: 0.5 }}
                          >
                            Learn more →
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                </ListItem>
              ))}
            </List>
            <Divider sx={{ my: 2 }} />
          </>
        )}

        {suggestedCorrection && (
          <>
            <Typography variant="subtitle1" gutterBottom fontWeight="medium">
              Suggested corrections
            </Typography>
            <List dense>
              {suggestedCorrection.split(' • ').map((tip, i) => (
                <ListItem key={i}>
                  <ListItemText primary={tip} />
                </ListItem>
              ))}
            </List>
          </>
        )}

        {!rejectionReason && !suggestedCorrection && topics.length === 0 && approvalStatus !== 'UNKNOWN' && (
          <Typography variant="body2" color="text.secondary">
            No detailed review feedback available from the platform.
          </Typography>
        )}
      </DialogContent>

      <DialogActions>
        {onRefresh && (
          <Button
            onClick={handleRefresh}
            startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
            disabled={refreshing}
          >
            Refresh from platform
          </Button>
        )}
        <Box sx={{ flexGrow: 1 }} />
        <Button onClick={onClose}>Close</Button>
        <Button variant="contained" color="primary" startIcon={<EditIcon />} onClick={onEdit}>
          Edit ad
        </Button>
      </DialogActions>
    </Dialog>
  );
}
