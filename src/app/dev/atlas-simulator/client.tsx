'use client';

/**
 * Stands in for Atlas Console: opens `/auth` in a new window and posts a
 * synthetic `ATLAS_AUTH` envelope, with the timing and the shape both under
 * control so the failure modes can be reproduced deliberately.
 *
 * The token used here is synthetic and non-secret. Even so, the activity log
 * only ever prints its fingerprint, to keep the habit honest.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import {
  ATLAS_MESSAGE_TYPE,
  PROMOTE_READY_TYPE,
  describeToken,
  formatTokenFingerprint,
} from '@/app/auth/atlas-bridge';

/** Obviously synthetic, and shaped like a JWT so the fingerprint looks realistic. */
const SYNTHETIC_TOKEN =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.c2ltdWxhdGVkLWF0bGFzLXBheWxvYWQtbm90LWEtcmVhbC10b2tlbg.simulated-signature-not-valid';

export type EnvelopeShape = 'valid' | 'missing-token' | 'wrong-type' | 'missing-partner';
export type PostTiming = 'on-ready' | 'immediate' | 'delayed';
export type OriginMode = 'dev' | 'strict';
export type SessionMode = 'probe' | 'login';

export interface EnvelopeInput {
  token: string;
  partnerName: string;
  partnerEmail: string;
}

/** Built here rather than inline so the failure shapes are testable on their own. */
export function buildSimulatorEnvelope(
  shape: EnvelopeShape,
  { token, partnerName, partnerEmail }: EnvelopeInput
): Record<string, unknown> {
  const partner = { name: partnerName, email: partnerEmail };

  switch (shape) {
    case 'valid':
      return { type: ATLAS_MESSAGE_TYPE, token, partner };
    case 'missing-token':
      return { type: ATLAS_MESSAGE_TYPE, partner };
    case 'wrong-type':
      return { type: 'ATLAS_AUTH_V2', token, partner };
    case 'missing-partner':
      return { type: ATLAS_MESSAGE_TYPE, token };
  }
}

export function buildAuthUrl(mode: SessionMode, originMode: OriginMode): string {
  const params = new URLSearchParams({ mode });
  if (originMode === 'strict') params.set('origins', 'strict');
  return `/auth?${params.toString()}`;
}

const READY_WAIT_MS = 10_000;

export default function AtlasSimulatorClient() {
  const [token, setToken] = useState(SYNTHETIC_TOKEN);
  const [partnerName, setPartnerName] = useState('Simulated Partner');
  const [partnerEmail, setPartnerEmail] = useState('partner@example.test');
  const [mode, setMode] = useState<SessionMode>('probe');
  const [originMode, setOriginMode] = useState<OriginMode>('dev');
  const [timing, setTiming] = useState<PostTiming>('on-ready');
  const [delayMs, setDelayMs] = useState(3000);
  const [shape, setShape] = useState<EnvelopeShape>('valid');
  const [log, setLog] = useState<string[]>([]);

  const childRef = useRef<Window | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const append = useCallback((line: string) => {
    setLog((current) => [...current, line]);
  }, []);

  const post = useCallback(
    (child: Window, targetOrigin: string, note: string) => {
      if (child.closed) {
        append(`${note}: the target window is already closed. Nothing posted.`);
        return;
      }
      const envelope = buildSimulatorEnvelope(shape, { token, partnerName, partnerEmail });
      child.postMessage(envelope, targetOrigin);
      append(
        `${note}: posted ${String(envelope.type)} to ${targetOrigin} · token ${formatTokenFingerprint(
          describeToken(envelope.token)
        )}`
      );
    },
    [append, partnerEmail, partnerName, shape, token]
  );

  // Listens the way Console would: it is the opener, so PROMOTE_READY lands here.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: unknown } | null;
      if (!data || typeof data !== 'object' || data.type !== PROMOTE_READY_TYPE) return;
      if (childRef.current && event.source !== childRef.current) return;
      append(`Received ${PROMOTE_READY_TYPE} from ${event.origin}.`);
      if (timing === 'on-ready' && childRef.current) {
        post(childRef.current, event.origin, 'On PROMOTE_READY');
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [append, post, timing]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach(clearTimeout);
    };
  }, []);

  const handleOpen = useCallback(() => {
    setLog([]);
    const url = buildAuthUrl(mode, originMode);
    const child = window.open(url, '_blank', 'width=980,height=900');

    if (!child) {
      append('window.open returned null — the browser blocked the popup. Allow popups and retry.');
      return;
    }

    childRef.current = child;
    append(`Opened ${url} in a new window.`);

    const targetOrigin = window.location.origin;

    if (timing === 'immediate') {
      // Posts before the new document has parsed anything. Expected to be lost:
      // this is the race the pre-paint listener cannot help with, and it should
      // show up on /auth as a timeout, not as a failure.
      post(child, targetOrigin, 'Immediately (expected to be lost)');
      return;
    }

    if (timing === 'delayed') {
      const timer = setTimeout(() => post(child, targetOrigin, `After ${delayMs}ms`), delayMs);
      timersRef.current.push(timer);
      return;
    }

    const timer = setTimeout(() => {
      append(
        `No ${PROMOTE_READY_TYPE} within ${READY_WAIT_MS / 1000}s. Either the page did not load, ` +
          'or this origin is not in its allowlist so the signal could not be addressed here.'
      );
    }, READY_WAIT_MS);
    timersRef.current.push(timer);
  }, [append, delayMs, mode, originMode, post, timing]);

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Atlas Console simulator
      </Typography>
      <Alert severity="warning" sx={{ mb: 3 }}>
        Development only. This route answers 404 in production. The token below is synthetic:
        the session exchange will fail against the real Atlas, which is the point — it proves
        our half of the handshake independently of Crazy Cake.
      </Alert>

      <Card>
        <CardContent>
          <Stack spacing={3}>
            <TextField
              label="Token (synthetic)"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              fullWidth
              multiline
              minRows={2}
            />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField
                label="Partner name"
                value={partnerName}
                onChange={(event) => setPartnerName(event.target.value)}
                fullWidth
              />
              <TextField
                label="Partner email"
                value={partnerEmail}
                onChange={(event) => setPartnerEmail(event.target.value)}
                fullWidth
              />
            </Stack>

            <Divider />

            <FormControl>
              <FormLabel>Session mode</FormLabel>
              <RadioGroup
                row
                value={mode}
                onChange={(event) => setMode(event.target.value as SessionMode)}
              >
                <FormControlLabel value="probe" control={<Radio />} label="probe (no cookie)" />
                <FormControlLabel value="login" control={<Radio />} label="login" />
              </RadioGroup>
            </FormControl>

            <FormControl>
              <FormLabel>Origin allowlist</FormLabel>
              <RadioGroup
                value={originMode}
                onChange={(event) => setOriginMode(event.target.value as OriginMode)}
              >
                <FormControlLabel
                  value="dev"
                  control={<Radio />}
                  label="dev — this origin is accepted, the envelope should be processed"
                />
                <FormControlLabel
                  value="strict"
                  control={<Radio />}
                  label="strict (?origins=strict) — this origin is NOT accepted, expect a visible rejection"
                />
              </RadioGroup>
            </FormControl>

            <FormControl>
              <FormLabel>When to post</FormLabel>
              <RadioGroup
                value={timing}
                onChange={(event) => setTiming(event.target.value as PostTiming)}
              >
                <FormControlLabel
                  value="on-ready"
                  control={<Radio />}
                  label="on PROMOTE_READY — realistic; usually lands before React mounts, so it is buffered"
                />
                <FormControlLabel
                  value="immediate"
                  control={<Radio />}
                  label="immediately after window.open — expect the message to be lost and /auth to time out"
                />
                <FormControlLabel
                  value="delayed"
                  control={<Radio />}
                  label="after a delay — arrives live, once the view is already subscribed"
                />
              </RadioGroup>
            </FormControl>

            {timing === 'delayed' && (
              <TextField
                label="Delay (ms)"
                type="number"
                value={delayMs}
                onChange={(event) => setDelayMs(Number(event.target.value) || 0)}
                sx={{ maxWidth: 200 }}
              />
            )}

            <FormControl>
              <FormLabel>Envelope shape</FormLabel>
              <RadioGroup
                value={shape}
                onChange={(event) => setShape(event.target.value as EnvelopeShape)}
              >
                <FormControlLabel value="valid" control={<Radio />} label="valid Contract B envelope" />
                <FormControlLabel value="missing-token" control={<Radio />} label="missing token" />
                <FormControlLabel value="missing-partner" control={<Radio />} label="missing partner" />
                <FormControlLabel value="wrong-type" control={<Radio />} label="unexpected type" />
              </RadioGroup>
            </FormControl>

            <Box>
              <Button variant="contained" size="large" onClick={handleOpen}>
                Open /auth and post {ATLAS_MESSAGE_TYPE}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Activity
          </Typography>
          {log.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nothing yet.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {log.map((line, index) => (
                <Typography key={index} variant="body2" sx={{ fontFamily: 'monospace' }}>
                  {line}
                </Typography>
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>
    </Container>
  );
}
