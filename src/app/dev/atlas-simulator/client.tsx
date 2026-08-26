'use client';

/**
 * Stands in for Atlas Console: opens `/auth` in a new window and posts an
 * `ATLAS_AUTH` envelope, with the timing and the shape both under control so the
 * failure modes reproduce on demand.
 *
 * This is not a convenience. The destination URL was configured on Crazy Cake's
 * side in January and points at production, so nobody can make Console open a
 * localhost window. Driving `/auth` from here is the only way to exercise our
 * half of the handshake before the code is in production.
 *
 * It also carries the one path that can settle Contract C today: a real token,
 * pasted by hand, posted through the same `postMessage` the real Console uses.
 * Deliberately through that path and not injected into the page's state — a
 * shortcut past our own listener would validate the boundary with a fake, which
 * is exactly what must not happen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Container,
  Divider,
  FormControl,
  FormControlLabel,
  FormLabel,
  IconButton,
  InputAdornment,
  Radio,
  RadioGroup,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
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

/**
 * Every token field on this page is masked by default, whichever token it holds.
 *
 * Not because the synthetic one is secret, but because this is the screen that
 * gets screenshotted to report results, and a field that is sometimes safe to
 * show trains the habit of showing it. Revealing is one deliberate click.
 */
function MaskedTokenField({
  label,
  helperText,
  value,
  onChange,
  inputRef,
}: {
  label: string;
  helperText?: string;
  value?: string;
  onChange?: (value: string) => void;
  inputRef?: React.Ref<HTMLInputElement>;
}) {
  const [revealed, setRevealed] = useState(false);

  return (
    <TextField
      label={label}
      helperText={helperText}
      type={revealed ? 'text' : 'password'}
      fullWidth
      autoComplete="off"
      spellCheck={false}
      {...(value !== undefined ? { value } : {})}
      {...(onChange ? { onChange: (event) => onChange(event.target.value) } : {})}
      {...(inputRef ? { inputRef } : {})}
      slotProps={{
        htmlInput: { 'data-lpignore': 'true' },
        input: {
          endAdornment: (
            <InputAdornment position="end">
              <Tooltip title={revealed ? 'Hide' : 'Reveal'}>
                <IconButton
                  aria-label={revealed ? `Hide ${label}` : `Reveal ${label}`}
                  onClick={() => setRevealed((current) => !current)}
                  edge="end"
                  size="small"
                >
                  {revealed ? <VisibilityOffIcon /> : <VisibilityIcon />}
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ),
        },
      }}
    />
  );
}

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

  /**
   * The real production JWT. Uncontrolled on purpose: React never manages this
   * value, so it never reaches component state and cannot end up rendered. It is
   * read once, at the moment of posting, and the field is cleared afterwards.
   * Never stored, never put in the URL, never logged.
   */
  const realTokenInputRef = useRef<HTMLInputElement>(null);

  const childRef = useRef<Window | null>(null);
  const pendingRef = useRef<Record<string, unknown> | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const append = useCallback((line: string) => {
    setLog((current) => [...current, line]);
  }, []);

  const post = useCallback(
    (child: Window, targetOrigin: string, note: string, envelope: Record<string, unknown>) => {
      if (child.closed) {
        append(`${note}: the target window is already closed. Nothing posted.`);
        return;
      }
      child.postMessage(envelope, targetOrigin);
      // Fingerprint only. Never the token itself, not even in development.
      append(
        `${note}: posted ${String(envelope.type)} to ${targetOrigin} · token ${formatTokenFingerprint(
          describeToken(envelope.token)
        )}`
      );
    },
    [append]
  );

  // Listens the way Console would: it is the opener, so PROMOTE_READY lands here.
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { type?: unknown } | null;
      if (!data || typeof data !== 'object' || data.type !== PROMOTE_READY_TYPE) return;
      if (childRef.current && event.source !== childRef.current) return;
      append(`Received ${PROMOTE_READY_TYPE} from ${event.origin}.`);
      const envelope = pendingRef.current;
      if (timing === 'on-ready' && childRef.current && envelope) {
        pendingRef.current = null;
        post(childRef.current, event.origin, 'On PROMOTE_READY', envelope);
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

  const launch = useCallback(
    (envelope: Record<string, unknown>, sessionMode: SessionMode, banner: string) => {
      setLog([]);
      const url = buildAuthUrl(sessionMode, originMode);
      const child = window.open(url, '_blank', 'width=980,height=900');

      if (!child) {
        append('window.open returned null — the browser blocked the popup. Allow popups and retry.');
        return;
      }

      childRef.current = child;
      pendingRef.current = envelope;
      append(banner);
      append(`Opened ${url} in a new window.`);

      const targetOrigin = window.location.origin;

      if (timing === 'immediate') {
        // Posts before the new document has parsed anything. Expected to be lost:
        // this is the race the pre-paint listener cannot help with, and it should
        // show up on /auth as a timeout, not as a failure.
        pendingRef.current = null;
        post(child, targetOrigin, 'Immediately (expected to be lost)', envelope);
        return;
      }

      if (timing === 'delayed') {
        const timer = setTimeout(() => {
          pendingRef.current = null;
          post(child, targetOrigin, `After ${delayMs}ms`, envelope);
        }, delayMs);
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
    },
    [append, delayMs, originMode, post, timing]
  );

  const handleSyntheticLaunch = useCallback(() => {
    launch(
      buildSimulatorEnvelope(shape, { token, partnerName, partnerEmail }),
      mode,
      'Using the synthetic token.'
    );
  }, [launch, mode, partnerEmail, partnerName, shape, token]);

  const handleRealTokenLaunch = useCallback(() => {
    const input = realTokenInputRef.current;
    const realToken = input?.value.trim() ?? '';

    if (!realToken) {
      append('No real token was pasted. Nothing was opened.');
      return;
    }

    // Always a well-formed envelope and always probe mode: this path exists to
    // settle Contract C, and probe is the mode that never issues a session.
    launch(
      buildSimulatorEnvelope('valid', {
        token: realToken,
        partnerName,
        partnerEmail,
      }),
      'probe',
      `Using the pasted token · ${formatTokenFingerprint(describeToken(realToken))}`
    );

    // Cleared as soon as it has been handed over, so it does not sit in the page.
    if (input) input.value = '';
  }, [append, launch, partnerEmail, partnerName]);

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Atlas Console simulator
      </Typography>
      <Alert severity="warning" sx={{ mb: 3 }}>
        Development only. This route answers 404 in production.
      </Alert>

      <Card sx={{ mb: 3, borderColor: 'warning.main', borderWidth: 2, borderStyle: 'solid' }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Real token (settles Contract C)
          </Typography>
          <Alert severity="error" sx={{ mb: 2 }}>
            <AlertTitle>This field takes a real production credential</AlertTitle>
            A JWT copied out of a live <code>dashboard.pijamafilms.com</code> session is a
            credential, even though it expires in 24 hours. It is posted through the same
            <code> postMessage</code> path Console uses — never injected into the page directly,
            because a shortcut past our own listener would prove nothing. It is not stored, not
            logged, not put in the URL, and the field is cleared the moment it is used.
          </Alert>
          <MaskedTokenField
            inputRef={realTokenInputRef}
            label="Paste a real Atlas JWT"
            helperText="Runs in probe mode only: no session cookie is ever issued from this path."
          />
          <Box sx={{ mt: 2 }}>
            <Button variant="contained" color="warning" onClick={handleRealTokenLaunch}>
              Open /auth in probe mode and post the real token
            </Button>
          </Box>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Synthetic run
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
            This half drives the handshake with a made-up token and every failure mode on demand:
            timing, origin and envelope shape are all selectable, so our side can be proved out
            without Crazy Cake. The token below is pre-filled with a synthetic value and the
            exchange with Atlas will fail — that is the point, and it does not affect anything
            being tested here.{' '}
            <strong>
              To settle Contract C with a real production JWT, use the field above, not this one:
              this form can be switched into login mode and that one cannot.
            </strong>
          </Typography>
          <Stack spacing={3}>
            <MaskedTokenField
              label="Token (synthetic by default)"
              helperText="Masked like the field above, so a screenshot of this page never carries a token."
              value={token}
              onChange={setToken}
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
                <FormControlLabel
                  value="wrong-type"
                  control={<Radio />}
                  label="different event type — expect it to be ignored, not accepted"
                />
              </RadioGroup>
            </FormControl>

            <Box>
              <Button variant="contained" size="large" onClick={handleSyntheticLaunch}>
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
