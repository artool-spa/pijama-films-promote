'use client';

import {
  Box,
  Button,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useState } from 'react';

const CALL_TO_ACTION_OPTIONS = [
  { value: 'WATCH_MORE', label: 'Watch more' },
  { value: 'LEARN_MORE', label: 'Learn more' },
  { value: 'SHOP_NOW', label: 'Shop now' },
  { value: 'SIGN_UP', label: 'Sign up' },
  { value: 'SUBSCRIBE', label: 'Subscribe' },
  { value: 'BUY_NOW', label: 'Buy now' },
];

export type AdEditFormValues = {
  headlines: string[];
  bodies: string[];
  descriptions: string[];
  callToAction: string;
  linkUrl: string;
};

export type AdEditFormProps = {
  initial: AdEditFormValues;
  onSubmit: (values: AdEditFormValues) => Promise<void>;
  onCancel?: () => void;
  submitting?: boolean;
};

function TextFieldArrayEditor({
  label,
  values,
  onChange,
  max,
  helperText,
  multiline,
  maxLength,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
  helperText?: string;
  multiline?: boolean;
  maxLength?: number;
}) {
  return (
    <Box>
      <Typography variant="subtitle2" gutterBottom>
        {label} ({values.length}/{max})
      </Typography>
      <Stack spacing={1.5}>
        {values.map((value, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <TextField
              fullWidth
              size="small"
              value={value}
              multiline={multiline}
              minRows={multiline ? 2 : 1}
              inputProps={{ maxLength }}
              onChange={(e) => {
                const next = [...values];
                next[i] = e.target.value;
                onChange(next);
              }}
            />
            <IconButton
              size="small"
              color="error"
              onClick={() => onChange(values.filter((_, j) => j !== i))}
              disabled={values.length <= 1}
            >
              <DeleteIcon fontSize="small" />
            </IconButton>
          </Box>
        ))}
        {values.length < max && (
          <Button
            startIcon={<AddIcon />}
            size="small"
            onClick={() => onChange([...values, ''])}
            sx={{ alignSelf: 'flex-start' }}
          >
            Add
          </Button>
        )}
      </Stack>
      {helperText && (
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {helperText}
        </Typography>
      )}
    </Box>
  );
}

export default function AdEditForm({ initial, onSubmit, onCancel, submitting }: AdEditFormProps) {
  const [headlines, setHeadlines] = useState<string[]>(initial.headlines);
  const [bodies, setBodies] = useState<string[]>(initial.bodies);
  const [descriptions, setDescriptions] = useState<string[]>(
    initial.descriptions.length > 0 ? initial.descriptions : ['']
  );
  const [callToAction, setCallToAction] = useState<string>(initial.callToAction);
  const [linkUrl, setLinkUrl] = useState<string>(initial.linkUrl);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit({
      headlines: headlines.filter((h) => h.trim().length > 0),
      bodies: bodies.filter((b) => b.trim().length > 0),
      descriptions: descriptions.filter((d) => d.trim().length > 0),
      callToAction,
      linkUrl: linkUrl.trim(),
    });
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={3}>
        <TextFieldArrayEditor
          label="Headlines"
          values={headlines}
          onChange={setHeadlines}
          max={5}
          maxLength={255}
          helperText="Short attention-grabbing lines. Meta will test multiple headlines automatically."
        />

        <TextFieldArrayEditor
          label="Primary text"
          values={bodies}
          onChange={setBodies}
          max={5}
          multiline
          maxLength={2200}
          helperText="Main body of the ad."
        />

        <TextFieldArrayEditor
          label="Descriptions"
          values={descriptions}
          onChange={setDescriptions}
          max={5}
          maxLength={30}
          helperText="Short link descriptions (max 30 chars each)."
        />

        <TextField
          label="Destination URL"
          fullWidth
          size="small"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          required
        />

        <TextField
          select
          label="Call to action"
          fullWidth
          size="small"
          value={callToAction}
          onChange={(e) => setCallToAction(e.target.value)}
        >
          {CALL_TO_ACTION_OPTIONS.map((opt) => (
            <MenuItem key={opt.value} value={opt.value}>
              {opt.label}
            </MenuItem>
          ))}
        </TextField>

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
          {onCancel && (
            <Button onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="contained" color="primary" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save changes'}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
