'use client';

import { Box, IconButton, Tooltip } from '@mui/material';
import {
  PlayArrow as PlayIcon,
  Pause as PauseIcon,
  Stop as StopIcon,
} from '@mui/icons-material';

type CampaignStatus = 'running' | 'paused' | 'completed';

type CampaignActionButtonsProps = {
  status: CampaignStatus;
  onStatusChange: (newStatus: CampaignStatus) => void;
  size?: 'small' | 'medium' | 'large';
};

export default function CampaignActionButtons({
  status,
  onStatusChange,
  size = 'medium',
}: CampaignActionButtonsProps) {
  const handlePlay = () => {
    if (status !== 'running') {
      onStatusChange('running');
    }
  };

  const handlePause = () => {
    if (status === 'running') {
      onStatusChange('paused');
    }
  };

  const handleStop = () => {
    if (status !== 'completed') {
      onStatusChange('completed');
    }
  };

  return (
    <Box sx={{ display: 'flex', gap: 0.5 }}>
      {/* Play Button - shown when paused or completed */}
      {status !== 'running' && (
        <Tooltip title={status === 'completed' ? 'Restart Campaign' : 'Start'}>
          <IconButton
            size={size}
            color="primary"
            onClick={handlePlay}
            disabled={status === 'completed'}
          >
            <PlayIcon fontSize={size} />
          </IconButton>
        </Tooltip>
      )}

      {/* Pause Button - shown only when running */}
      {status === 'running' && (
        <Tooltip title="Pause">
          <IconButton
            size={size}
            color="primary"
            onClick={handlePause}
          >
            <PauseIcon fontSize={size} />
          </IconButton>
        </Tooltip>
      )}

      {/* Stop Button - always shown, disabled when completed */}
      <Tooltip title={status === 'completed' ? 'Campaign Finished' : 'Stop'}>
        <span>
          <IconButton
            size={size}
            color="primary"
            onClick={handleStop}
            disabled={status === 'completed'}
          >
            <StopIcon fontSize={size} />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}
