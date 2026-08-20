'use client';

import {
  Box,
  Button,
  IconButton,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { Add as AddIcon, Delete as DeleteIcon } from '@mui/icons-material';
import { useState } from 'react';

/** Meta caps headlines at 255 chars; Google Demand Gen caps them at 40. */
const META_HEADLINE_MAX_LENGTH = 255;

export type AdEditFormValues = {
  headlines: string[];
  bodies: string[];
  descriptions: string[];
  linkUrl: string;
};

export type AdEditFormProps = {
  initial: AdEditFormValues;
  onSubmit: (values: AdEditFormValues) => Promise<void>;
  onCancel?: () => void;
  submitting?: boolean;
  submitLabel?: string;
  /** Tighter headline limit for Google-synced ads. Defaults to Meta's 255. */
  headlineMaxLength?: number;
  /** Google Demand Gen requires at least one description. */
  requireDescription?: boolean;
};

function TextFieldArrayEditor({
  label,
  values,
  onChange,
  max,
  helperText,
  multiline,
  maxLength,
  error,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  max: number;
  helperText?: string;
  multiline?: boolean;
  maxLength?: number;
  error?: string;
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
              error={!!error}
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
      {(error || helperText) && (
        <Typography
          variant="caption"
          color={error ? 'error' : 'text.secondary'}
          display="block"
          sx={{ mt: 0.5 }}
        >
          {error || helperText}
        </Typography>
      )}
    </Box>
  );
}

export default function AdEditForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
  submitLabel = 'Save changes',
  headlineMaxLength = META_HEADLINE_MAX_LENGTH,
  requireDescription = false,
}: AdEditFormProps) {
  const [headlines, setHeadlines] = useState<string[]>(initial.headlines);
  const [bodies, setBodies] = useState<string[]>(initial.bodies);
  const [descriptions, setDescriptions] = useState<string[]>(
    initial.descriptions.length > 0 ? initial.descriptions : ['']
  );
  const [linkUrl, setLinkUrl] = useState<string>(initial.linkUrl);
  const [errors, setErrors] = useState<{
    headlines?: string;
    bodies?: string;
    descriptions?: string;
  }>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const values: AdEditFormValues = {
      headlines: headlines.filter((h) => h.trim().length > 0),
      bodies: bodies.filter((b) => b.trim().length > 0),
      descriptions: descriptions.filter((d) => d.trim().length > 0),
      linkUrl: linkUrl.trim(),
    };

    // The server rejects empty headlines/bodies with an opaque 400, so catch it here.
    const nextErrors: typeof errors = {};
    if (values.headlines.length === 0) {
      nextErrors.headlines = 'Add at least one headline.';
    }
    if (values.bodies.length === 0) {
      nextErrors.bodies = 'Add at least one primary text.';
    }
    if (requireDescription && values.descriptions.length === 0) {
      nextErrors.descriptions = 'Google Ads requires at least one description.';
    }

    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    await onSubmit(values);
  };

  return (
    <Box component="form" onSubmit={handleSubmit}>
      <Stack spacing={3}>
        <TextFieldArrayEditor
          label="Headlines"
          values={headlines}
          onChange={setHeadlines}
          max={5}
          maxLength={headlineMaxLength}
          error={errors.headlines}
          helperText={
            headlineMaxLength < META_HEADLINE_MAX_LENGTH
              ? `Short attention-grabbing lines. Google Ads limits headlines to ${headlineMaxLength} characters.`
              : 'Short attention-grabbing lines. Meta will test multiple headlines automatically.'
          }
        />

        <TextFieldArrayEditor
          label="Primary text"
          values={bodies}
          onChange={setBodies}
          max={5}
          multiline
          maxLength={2200}
          error={errors.bodies}
          helperText="Main body of the ad."
        />

        <TextFieldArrayEditor
          label="Descriptions"
          values={descriptions}
          onChange={setDescriptions}
          max={5}
          maxLength={30}
          error={errors.descriptions}
          helperText={
            requireDescription
              ? 'Short link descriptions (max 30 chars each). Google Ads requires at least one.'
              : 'Short link descriptions (max 30 chars each).'
          }
        />

        <TextField
          label="Destination URL"
          fullWidth
          size="small"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
          required
        />

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, mt: 1 }}>
          {onCancel && (
            <Button onClick={onCancel} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button type="submit" variant="contained" color="primary" disabled={submitting}>
            {submitting ? 'Saving...' : submitLabel}
          </Button>
        </Box>
      </Stack>
    </Box>
  );
}
