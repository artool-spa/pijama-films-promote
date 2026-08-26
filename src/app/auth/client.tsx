'use client';

/**
 * View for `/auth`. Reads what the pre-paint bridge captured, classifies it, and
 * exchanges a valid `ATLAS_AUTH` envelope through Contract A.
 *
 * Token handling: the raw token lives in a ref and is written only into the
 * request body. It is never put in state, never rendered, never logged and never
 * written to a DOM attribute. Only its length and first characters are shown.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Container,
  Divider,
  Stack,
  Typography,
} from '@mui/material';
import {
  ATLAS_MESSAGE_TYPE,
  ATLAS_SESSION_ENDPOINT,
  atlasAuthEnvelopeSchema,
  describeToken,
  formatTokenFingerprint,
  isSafeRedirect,
  parseSessionResponse,
  readBridge,
  type AtlasSessionMode,
  type BridgeMessage,
  type ParsedSessionResponse,
  type TokenFingerprint,
} from './atlas-bridge';

type Phase =
  | 'waiting'
  | 'timed-out'
  | 'origin-rejected'
  | 'malformed'
  | 'exchanging'
  | 'authenticated'
  | 'failed';

type Verdict = 'accepted' | 'rejected-origin' | 'malformed' | 'other-type';

interface PanelEvent {
  id: number;
  origin: string;
  type: string;
  buffered: boolean;
  verdict: Verdict;
  token: TokenFingerprint;
  partner: { name: string; email: string } | null;
  detail?: string;
}

interface ExchangeState {
  mode: AtlasSessionMode;
  running: boolean;
  httpStatus: number | null;
  response: ParsedSessionResponse | null;
  /** Our own label for a failure that never reached Contract A's body. */
  transportError: string | null;
}

interface BridgeSnapshot {
  allowedOrigins: string[];
  hasOpener: boolean;
  readyPostedTo: string[];
  readyFailedFor: string[];
  installed: boolean;
}

export interface AtlasAuthClientProps {
  allowedOrigins: string[];
  allowSelfOrigin: boolean;
  mode: AtlasSessionMode;
  timeoutMs: number;
}

export default function AtlasAuthClient({
  allowedOrigins,
  allowSelfOrigin,
  mode,
  timeoutMs,
}: AtlasAuthClientProps) {
  const router = useRouter();

  const [phase, setPhase] = useState<Phase>('waiting');
  const [events, setEvents] = useState<PanelEvent[]>([]);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [snapshot, setSnapshot] = useState<BridgeSnapshot>({
    allowedOrigins,
    hasOpener: false,
    readyPostedTo: [],
    readyFailedFor: [],
    installed: false,
  });
  const [exchange, setExchange] = useState<ExchangeState>({
    mode,
    running: false,
    httpStatus: null,
    response: null,
    transportError: null,
  });

  /** Raw token. Deliberately not state: state ends up rendered. */
  const tokenRef = useRef<string | null>(null);
  /** Survives the StrictMode double-mount so a drained buffer is never lost. */
  const eventsRef = useRef<PanelEvent[]>([]);
  const handledRef = useRef(false);
  const sawAnyMessageRef = useRef(false);

  const runExchange = useCallback(
    async (token: string, requestedMode: AtlasSessionMode) => {
      setPhase('exchanging');
      setExchange({
        mode: requestedMode,
        running: true,
        httpStatus: null,
        response: null,
        transportError: null,
      });

      let httpStatus: number | null = null;
      let body: unknown = null;
      try {
        const httpResponse = await fetch(ATLAS_SESSION_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, mode: requestedMode }),
        });
        httpStatus = httpResponse.status;
        try {
          body = await httpResponse.json();
        } catch {
          body = null;
        }
      } catch (error) {
        setPhase('failed');
        setExchange({
          mode: requestedMode,
          running: false,
          httpStatus: null,
          response: null,
          transportError: `Could not reach ${ATLAS_SESSION_ENDPOINT}: ${
            error instanceof Error ? error.message : 'network error'
          }`,
        });
        return;
      }

      const parsed = body === null ? null : parseSessionResponse(body);

      if (!parsed) {
        // Most likely cause while the server domain is still in flight: the route
        // does not exist yet, so Next answers with an HTML 404.
        setPhase('failed');
        setExchange({
          mode: requestedMode,
          running: false,
          httpStatus,
          response: null,
          transportError:
            `HTTP ${httpStatus ?? '?'} with a body that does not match Contract A. ` +
            'The endpoint is missing or returned non-JSON.',
        });
        return;
      }

      setExchange({
        mode: requestedMode,
        running: false,
        httpStatus,
        response: parsed,
        transportError: null,
      });

      if (!parsed.ok) {
        setPhase('failed');
        return;
      }

      setPhase('authenticated');

      if (requestedMode === 'login' && isSafeRedirect(parsed.redirectTo)) {
        router.push(parsed.redirectTo);
        router.refresh();
      }
    },
    [router]
  );

  const pushEvent = useCallback((event: Omit<PanelEvent, 'id'>) => {
    const withId: PanelEvent = { ...event, id: eventsRef.current.length };
    eventsRef.current = [...eventsRef.current, withId];
    setEvents(eventsRef.current);
  }, []);

  const handleMessage = useCallback(
    (message: BridgeMessage) => {
      sawAnyMessageRef.current = true;

      if (message.type !== ATLAS_MESSAGE_TYPE) {
        pushEvent({
          origin: message.origin,
          type: message.type,
          buffered: message.buffered,
          verdict: 'other-type',
          token: describeToken(null),
          partner: null,
          detail: `Ignored: expected type "${ATLAS_MESSAGE_TYPE}".`,
        });
        return;
      }

      // The raw payload is only ever inspected here; nothing from it besides the
      // fingerprint and the partner identity moves into state.
      const rawToken = (message.payload as { token?: unknown } | null)?.token;
      const fingerprint = describeToken(rawToken);

      if (!message.allowed) {
        pushEvent({
          origin: message.origin,
          type: message.type,
          buffered: message.buffered,
          verdict: 'rejected-origin',
          token: fingerprint,
          partner: null,
          detail:
            'Origin is not in NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS. The envelope was discarded.',
        });
        setPhase((current) => (current === 'waiting' || current === 'timed-out' ? 'origin-rejected' : current));
        return;
      }

      const parsed = atlasAuthEnvelopeSchema.safeParse(message.payload);

      if (!parsed.success) {
        pushEvent({
          origin: message.origin,
          type: message.type,
          buffered: message.buffered,
          verdict: 'malformed',
          token: fingerprint,
          partner: null,
          detail: `Does not match Contract B: ${parsed.error.issues
            .map((issue) => `${issue.path.join('.') || 'envelope'} ${issue.message}`)
            .join('; ')}`,
        });
        setPhase((current) => (current === 'waiting' || current === 'timed-out' ? 'malformed' : current));
        return;
      }

      pushEvent({
        origin: message.origin,
        type: message.type,
        buffered: message.buffered,
        verdict: 'accepted',
        token: describeToken(parsed.data.token),
        partner: parsed.data.partner,
      });

      if (handledRef.current) return;
      handledRef.current = true;
      tokenRef.current = parsed.data.token;
      void runExchange(parsed.data.token, mode);
    },
    [mode, pushEvent, runExchange]
  );

  // Subscribe to the pre-paint bridge. Everything it buffered arrives here first,
  // flagged `buffered`, which is the observable proof the race was survived.
  useEffect(() => {
    const bridge = readBridge();
    if (!bridge) {
      setSnapshot((current) => ({ ...current, installed: false }));
      return;
    }

    setSnapshot({
      installed: true,
      allowedOrigins: bridge.allowedOrigins,
      hasOpener: bridge.readySignal.hasOpener,
      readyPostedTo: bridge.readySignal.postedTo,
      readyFailedFor: bridge.readySignal.failedFor,
    });

    const unsubscribe = bridge.subscribe((message) => {
      handleMessage(message);
      setIgnoredCount(bridge.ignoredCount);
    });
    setIgnoredCount(bridge.ignoredCount);

    return unsubscribe;
  }, [handleMessage]);

  // "Nothing ever arrived" has to be distinguishable from "something arrived and
  // failed", otherwise a timing bug and a contract bug look identical on screen.
  useEffect(() => {
    const timer = setTimeout(() => {
      setPhase((current) => (current === 'waiting' ? 'timed-out' : current));
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [timeoutMs]);

  const seconds = Math.round(timeoutMs / 1000);

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Atlas Console sign-in
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        This window is waiting for Atlas Console to post an {ATLAS_MESSAGE_TYPE} message.
        Everything below is diagnostic detail for the integration.
      </Typography>

      <StatusBanner
        phase={phase}
        seconds={seconds}
        sawAnyMessage={sawAnyMessageRef.current}
        exchange={exchange}
      />

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Listener
          </Typography>
          <Stack spacing={1}>
            <Row
              label="Pre-paint bridge"
              value={snapshot.installed ? 'installed' : 'NOT installed'}
            />
            <Row
              label="Allowed origins"
              value={
                snapshot.allowedOrigins.length > 0
                  ? snapshot.allowedOrigins.join(', ')
                  : 'none configured (NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS is empty)'
              }
            />
            <Row
              label="Opener present"
              value={snapshot.hasOpener ? 'yes' : 'no (window was not opened by Console)'}
            />
            <Row
              label="PROMOTE_READY posted to"
              value={
                snapshot.readyPostedTo.length > 0
                  ? snapshot.readyPostedTo.join(', ')
                  : 'nothing (no opener, or no allowed origins)'
              }
            />
            {snapshot.readyFailedFor.length > 0 && (
              <Row label="PROMOTE_READY failed for" value={snapshot.readyFailedFor.join(', ')} />
            )}
            <Row label="Requested mode" value={mode} />
            {allowSelfOrigin && (
              <Row
                label="Development allowance"
                value="this window's own origin is accepted (never in production; disable with ?origins=strict)"
              />
            )}
            {ignoredCount > 0 && (
              <Row label="Unrelated messages ignored" value={String(ignoredCount)} />
            )}
          </Stack>
        </CardContent>
      </Card>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Messages received
          </Typography>
          {events.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No message has been received yet.
            </Typography>
          ) : (
            <Stack spacing={2} divider={<Divider flexItem />}>
              {events.map((event) => (
                <EventRow key={event.id} event={event} />
              ))}
            </Stack>
          )}
        </CardContent>
      </Card>

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Session exchange ({ATLAS_SESSION_ENDPOINT})
          </Typography>
          <ExchangePanel exchange={exchange} />
          <Box sx={{ mt: 2 }}>
            <Button
              variant="outlined"
              size="small"
              disabled={exchange.running || tokenRef.current === null}
              onClick={() => {
                const token = tokenRef.current;
                if (token) void runExchange(token, 'probe');
              }}
            >
              Re-run as diagnostic probe
            </Button>
          </Box>
        </CardContent>
      </Card>
    </Container>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      <Typography variant="body2" sx={{ minWidth: 220, fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography variant="body2" sx={{ wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Box>
  );
}

const VERDICT_LABEL: Record<Verdict, string> = {
  accepted: 'Accepted',
  'rejected-origin': 'Rejected: origin not allowed',
  malformed: 'Rejected: envelope does not match Contract B',
  'other-type': 'Ignored: unrelated message type',
};

function EventRow({ event }: { event: PanelEvent }) {
  const color =
    event.verdict === 'accepted' ? 'success' : event.verdict === 'other-type' ? 'default' : 'error';

  return (
    <Box>
      <Stack direction="row" spacing={1} sx={{ mb: 1, flexWrap: 'wrap', rowGap: 1 }}>
        <Chip size="small" color={color} label={VERDICT_LABEL[event.verdict]} />
        <Chip size="small" variant="outlined" label={event.buffered ? 'buffered pre-mount' : 'live'} />
      </Stack>
      <Stack spacing={0.5}>
        <Row label="Origin" value={event.origin || '(empty)'} />
        <Row label="Event type" value={event.type} />
        <Row label="Token" value={formatTokenFingerprint(event.token)} />
        <Row
          label="Partner"
          value={event.partner ? `${event.partner.name} <${event.partner.email}>` : 'not provided'}
        />
        {event.detail && <Row label="Detail" value={event.detail} />}
      </Stack>
    </Box>
  );
}

function ExchangePanel({ exchange }: { exchange: ExchangeState }) {
  if (exchange.running) {
    return (
      <Stack direction="row" spacing={2} alignItems="center">
        <CircularProgress size={20} />
        <Typography variant="body2">Calling in {exchange.mode} mode…</Typography>
      </Stack>
    );
  }

  if (exchange.transportError) {
    return (
      <Stack spacing={1}>
        <Row label="Mode" value={exchange.mode} />
        <Row label="HTTP status" value={exchange.httpStatus === null ? 'no response' : String(exchange.httpStatus)} />
        <Row label="Stage" value="transport (detected by this page, not reported by the endpoint)" />
        <Row label="Detail" value={exchange.transportError} />
      </Stack>
    );
  }

  const response = exchange.response;
  if (!response) {
    return (
      <Typography variant="body2" color="text.secondary">
        Not called yet. It runs as soon as a valid envelope arrives.
      </Typography>
    );
  }

  const diagnostics = response.diagnostics;

  return (
    <Stack spacing={1}>
      <Row label="Mode" value={exchange.mode} />
      <Row label="HTTP status" value={String(exchange.httpStatus)} />
      <Row label="Result" value={response.ok ? 'ok' : 'failed'} />
      {!response.ok && (
        <Row
          label="Stage"
          value={
            response.stage
              ? `${response.stage}${response.stageIsContractual ? '' : ' (not a Contract A stage)'}`
              : 'MISSING — Contract A requires a stage on every error'
          }
        />
      )}
      {response.message && <Row label="Message" value={response.message} />}
      {response.ok && response.redirectTo && <Row label="Redirect to" value={response.redirectTo} />}
      {diagnostics && (
        <>
          <Divider sx={{ my: 1 }} />
          {diagnostics.atlasUrlTried !== undefined && (
            <Row label="Atlas URL tried" value={diagnostics.atlasUrlTried} />
          )}
          {diagnostics.atlasStatus !== undefined && (
            <Row label="Atlas HTTP status" value={String(diagnostics.atlasStatus)} />
          )}
          {diagnostics.contractMatched !== undefined && (
            <Row label="Contract C matched" value={diagnostics.contractMatched ? 'yes' : 'no'} />
          )}
          {diagnostics.responseShapeKeys !== undefined && (
            <Row
              label="Atlas response keys"
              value={diagnostics.responseShapeKeys.length > 0 ? diagnostics.responseShapeKeys.join(', ') : '(none)'}
            />
          )}
          {diagnostics.partner !== undefined && (
            <Row
              label="Atlas partner"
              value={
                diagnostics.partner
                  ? `${diagnostics.partner.name ?? '?'} <${diagnostics.partner.email ?? '?'}> · partnerId ${
                      diagnostics.partner.partnerId ?? '?'
                    } · muviUuid ${diagnostics.partner.muviUuid ?? '?'}`
                  : 'null'
              }
            />
          )}
          {diagnostics.movieCount !== undefined && (
            <Row label="Movie count" value={String(diagnostics.movieCount)} />
          )}
          {diagnostics.movieSample !== undefined && diagnostics.movieSample.length > 0 && (
            <Row
              label="Movie sample"
              value={diagnostics.movieSample
                .map((movie) => `${movie.title ?? '?'} (${movie.muviUuid ?? '?'})`)
                .join(', ')}
            />
          )}
        </>
      )}
    </Stack>
  );
}

function StatusBanner({
  phase,
  seconds,
  sawAnyMessage,
  exchange,
}: {
  phase: Phase;
  seconds: number;
  sawAnyMessage: boolean;
  exchange: ExchangeState;
}) {
  switch (phase) {
    case 'waiting':
      return (
        <Alert severity="info" icon={<CircularProgress size={20} />}>
          <AlertTitle>Waiting for Atlas Console</AlertTitle>
          The listener is active. Nothing has arrived yet.
        </Alert>
      );
    case 'timed-out':
      return (
        <Alert severity="warning">
          <AlertTitle>No postMessage arrived within {seconds} seconds</AlertTitle>
          {sawAnyMessage
            ? `Messages did arrive, but none of them was an ${ATLAS_MESSAGE_TYPE} envelope.`
            : 'Nothing was posted to this window at all. This is a delivery problem, not a contract problem: Console either never posted, or posted to a different window.'}
        </Alert>
      );
    case 'origin-rejected':
      return (
        <Alert severity="error">
          <AlertTitle>Envelope rejected: origin not allowed</AlertTitle>
          An {ATLAS_MESSAGE_TYPE} message arrived from an origin outside the configured
          allowlist and was discarded. The origin is shown below.
        </Alert>
      );
    case 'malformed':
      return (
        <Alert severity="error">
          <AlertTitle>Envelope does not match Contract B</AlertTitle>
          The message came from an allowed origin but its shape is not{' '}
          {'{ type, token, partner }'}.
        </Alert>
      );
    case 'exchanging':
      return (
        <Alert severity="info" icon={<CircularProgress size={20} />}>
          <AlertTitle>Envelope accepted</AlertTitle>
          Exchanging the token in {exchange.mode} mode.
        </Alert>
      );
    case 'authenticated':
      return (
        <Alert severity="success">
          <AlertTitle>
            {exchange.mode === 'login' ? 'Signed in' : 'Probe succeeded'}
          </AlertTitle>
          {exchange.mode === 'login'
            ? 'A session cookie was issued. Redirecting…'
            : 'Atlas answered and the contract was exercised end to end. No session was issued.'}
        </Alert>
      );
    case 'failed':
      return (
        <Alert severity="error">
          <AlertTitle>Sign-in failed</AlertTitle>
          The envelope arrived and was accepted, but the session exchange failed. The stage
          is shown below.
        </Alert>
      );
  }
}
