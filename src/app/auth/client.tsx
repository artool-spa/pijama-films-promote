'use client';

/**
 * View for `/auth`. Reads what the pre-paint bridge captured, classifies it, and
 * exchanges a valid `ATLAS_AUTH` envelope through Contract A.
 *
 * Two things here are load-bearing for the question the project is answering,
 * and both are easy to lose in a refactor:
 *
 * 1. `diagnostics` is rendered wherever it appears, without consulting `ok` or
 *    the HTTP status. The only Atlas behaviour anyone has measured is a `302`,
 *    so the run that matters most is the one that comes back as a failure. A
 *    panel that renders diagnostics only on success would show nothing at all in
 *    the single scenario we know is coming.
 * 2. A rejected `login` escalates to a `probe` on its own. The real test happens
 *    once, in a window Console opens, and the account doing it is an
 *    administrator — so a rejection is the likely outcome. Leaving the diagnosis
 *    behind a button nobody presses wastes the only attempt.
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
  isInformationalStage,
  isSafeRedirect,
  parseSessionResponse,
  readBridge,
  stageConclusion,
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
  | 'settled';

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

interface ExchangeAttempt {
  id: number;
  mode: AtlasSessionMode;
  /** True when this page started the attempt itself rather than being asked to. */
  automatic: boolean;
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
  usingDefaultOrigins: boolean;
  mode: AtlasSessionMode;
  timeoutMs: number;
}

export default function AtlasAuthClient({
  allowedOrigins,
  allowSelfOrigin,
  usingDefaultOrigins,
  mode,
  timeoutMs,
}: AtlasAuthClientProps) {
  const router = useRouter();
  // Held in a ref so `runExchange` has no reactive dependency at all. With the
  // router in its dependency list, any host that hands back a fresh router object
  // per render would re-create the subscription effect on every render, and the
  // effect's own setState would spin that into an infinite loop.
  const routerRef = useRef(router);
  routerRef.current = router;

  const [phase, setPhase] = useState<Phase>('waiting');
  const [events, setEvents] = useState<PanelEvent[]>([]);
  const [attempts, setAttempts] = useState<ExchangeAttempt[]>([]);
  const [ignoredCount, setIgnoredCount] = useState(0);
  const [snapshot, setSnapshot] = useState<BridgeSnapshot>({
    allowedOrigins,
    hasOpener: false,
    readyPostedTo: [],
    readyFailedFor: [],
    installed: false,
  });

  /** Raw token. Deliberately not state: state ends up rendered. */
  const tokenRef = useRef<string | null>(null);
  /** Survives the StrictMode double-mount so a drained buffer is never lost. */
  const eventsRef = useRef<PanelEvent[]>([]);
  const handledRef = useRef(false);
  const sawAnyMessageRef = useRef(false);
  const autoProbeRef = useRef(false);
  const attemptSeq = useRef(0);

  const runExchange = useCallback(
    async (token: string, requestedMode: AtlasSessionMode, automatic = false) => {
      const id = attemptSeq.current++;
      setPhase('exchanging');
      setAttempts((current) => [
        ...current,
        {
          id,
          mode: requestedMode,
          automatic,
          running: true,
          httpStatus: null,
          response: null,
          transportError: null,
        },
      ]);

      const settle = (patch: Partial<ExchangeAttempt>) => {
        setAttempts((current) =>
          current.map((attempt) =>
            attempt.id === id ? { ...attempt, running: false, ...patch } : attempt
          )
        );
        setPhase('settled');
      };

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
        settle({
          transportError: `Could not reach ${ATLAS_SESSION_ENDPOINT}: ${
            error instanceof Error ? error.message : 'network error'
          }`,
        });
        return { ok: false };
      }

      const parsed = body === null ? null : parseSessionResponse(body);

      if (!parsed) {
        // Most likely cause while the server domain is still in flight: the route
        // does not exist yet, so Next answers with an HTML 404.
        settle({
          httpStatus,
          transportError:
            `HTTP ${httpStatus ?? '?'} with a body that does not match Contract A. ` +
            'The endpoint is missing or returned non-JSON.',
        });
        return { ok: false };
      }

      settle({ httpStatus, response: parsed });

      if (parsed.ok && requestedMode === 'login' && isSafeRedirect(parsed.redirectTo)) {
        routerRef.current.push(parsed.redirectTo);
        routerRef.current.refresh();
      }

      return { ok: parsed.ok };
    },
    []
  );

  /**
   * Runs the requested mode, and if a `login` did not succeed, immediately runs a
   * `probe` as well. The probe never issues a session, so escalating costs
   * nothing but one request — and it is the difference between JP reading
   * "rejected" and JP reading why.
   */
  const runWithAutoProbe = useCallback(
    async (token: string, requestedMode: AtlasSessionMode) => {
      const result = await runExchange(token, requestedMode);
      if (requestedMode !== 'login' || result.ok || autoProbeRef.current) return;
      autoProbeRef.current = true;
      await runExchange(token, 'probe', true);
    },
    [runExchange]
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
          detail: `Allowed origins are: ${
            allowedOrigins.length > 0 ? allowedOrigins.join(', ') : '(none configured)'
          }. The envelope was discarded.`,
        });
        setPhase((current) =>
          current === 'waiting' || current === 'timed-out' ? 'origin-rejected' : current
        );
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
        setPhase((current) =>
          current === 'waiting' || current === 'timed-out' ? 'malformed' : current
        );
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
      void runWithAutoProbe(parsed.data.token, mode);
    },
    [allowedOrigins, mode, pushEvent, runWithAutoProbe]
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
  const acceptedEvent = events.find((event) => event.verdict === 'accepted') ?? null;
  const rejectedEvent = events.find((event) => event.verdict === 'rejected-origin') ?? null;
  const originReceived = acceptedEvent?.origin ?? rejectedEvent?.origin ?? events[0]?.origin ?? null;

  return (
    <Container maxWidth="md" sx={{ py: 6 }}>
      <Typography variant="h4" component="h1" gutterBottom>
        Atlas Console sign-in
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        This window is waiting for Atlas Console to post an {ATLAS_MESSAGE_TYPE} message.
        Everything below is diagnostic detail for the integration.
      </Typography>

      {allowSelfOrigin && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Origin checking is relaxed in this window</AlertTitle>
          This window&apos;s own origin ({typeof window === 'undefined' ? '' : window.location.origin})
          has been added to the allowlist so the local simulator can drive the page. A green
          result here therefore does <strong>not</strong> prove the real allowlist works — the
          message could have been accepted through the widened list rather than the configured
          one. Re-run with <code>?origins=strict</code> to close that path and test the
          configured allowlist on its own. This never happens in production.
        </Alert>
      )}

      {usingDefaultOrigins && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Using the built-in allowlist, not a configured one</AlertTitle>
          <code>NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS</code> is unset or held no valid origin, so the
          built-in default is in use. That variable is baked in at build time, so setting it
          requires a new build — merging alone will not change this.
        </Alert>
      )}

      <StatusBanner
        phase={phase}
        seconds={seconds}
        sawAnyMessage={sawAnyMessageRef.current}
        attempts={attempts}
        requestedMode={mode}
        originReceived={originReceived}
        allowedOrigins={allowedOrigins}
      />

      <Card sx={{ mt: 3 }}>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Origins
          </Typography>
          <Stack spacing={1}>
            <Row
              label="Origin received"
              value={originReceived ?? 'nothing has posted to this window yet'}
              emphasis
            />
            <Row
              label="Origins allowed"
              value={
                snapshot.allowedOrigins.length > 0
                  ? snapshot.allowedOrigins.join(', ')
                  : 'none — every origin will be rejected'
              }
              emphasis
            />
          </Stack>
        </CardContent>
      </Card>

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
          {attempts.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Not called yet. It runs as soon as a valid envelope arrives.
            </Typography>
          ) : (
            <Stack spacing={3} divider={<Divider flexItem />}>
              {attempts.map((attempt) => (
                <AttemptPanel key={attempt.id} attempt={attempt} />
              ))}
            </Stack>
          )}
          <Box sx={{ mt: 2 }}>
            <Button
              variant="outlined"
              size="small"
              disabled={attempts.some((attempt) => attempt.running) || tokenRef.current === null}
              onClick={() => {
                const token = tokenRef.current;
                if (token) void runExchange(token, 'probe', false);
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

function Row({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
      <Typography variant="body2" sx={{ minWidth: 220, fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{
          wordBreak: 'break-word',
          fontWeight: emphasis ? 700 : 400,
          fontFamily: emphasis ? 'monospace' : undefined,
        }}
      >
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
        <Row label="Origin" value={event.origin || '(empty)'} emphasis />
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

function AttemptPanel({ attempt }: { attempt: ExchangeAttempt }) {
  const heading = `${attempt.mode} mode${attempt.automatic ? ' (run automatically)' : ''}`;

  if (attempt.running) {
    return (
      <Stack direction="row" spacing={2} alignItems="center">
        <CircularProgress size={20} />
        <Typography variant="body2">Calling in {heading}…</Typography>
      </Stack>
    );
  }

  const response = attempt.response;
  // Rendered wherever it appears. Never gated on `ok` or on the HTTP status: the
  // failing run is the one whose diagnostics we most need to see.
  const diagnostics = response?.diagnostics;

  return (
    <Stack spacing={1}>
      <Typography variant="subtitle2">{heading}</Typography>
      <Row
        label="HTTP status"
        value={attempt.httpStatus === null ? 'no response' : String(attempt.httpStatus)}
      />

      {attempt.transportError && (
        <>
          <Row
            label="Stage"
            value="transport (detected by this page, not reported by the endpoint)"
          />
          <Row label="Detail" value={attempt.transportError} />
        </>
      )}

      {response && (
        <>
          <Row label="Result" value={response.ok ? 'ok' : 'failed'} />
          {!response.ok && (
            <>
              <Row
                label="Stage"
                value={
                  response.stage
                    ? `${response.stage}${response.stageIsContractual ? '' : ' (not a Contract A stage)'}`
                    : 'MISSING — Contract A requires a stage on every error'
                }
                emphasis
              />
              {stageConclusion(response.stage) && (
                <Row label="What this means" value={stageConclusion(response.stage) as string} />
              )}
            </>
          )}
          {response.message && <Row label="Message" value={response.message} />}
          {response.ok && response.redirectTo && (
            <Row label="Redirect to" value={response.redirectTo} />
          )}
        </>
      )}

      {diagnostics && (
        <>
          <Divider sx={{ my: 1 }} />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Atlas diagnostics
          </Typography>
          {diagnostics.atlasUrlTried !== undefined && (
            <Row label="Atlas URL tried" value={diagnostics.atlasUrlTried} />
          )}
          {diagnostics.atlasStatus !== undefined && (
            <Row label="Atlas HTTP status" value={String(diagnostics.atlasStatus)} emphasis />
          )}
          {diagnostics.contractMatched !== undefined && (
            <Row label="Contract C matched" value={diagnostics.contractMatched ? 'yes' : 'no'} />
          )}
          {diagnostics.responseShapeKeys !== undefined && (
            <Row
              label="Atlas response keys"
              value={
                diagnostics.responseShapeKeys.length > 0
                  ? diagnostics.responseShapeKeys.join(', ')
                  : '(none)'
              }
              emphasis
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
                  : 'null — Atlas returned no partner for this account'
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
  attempts,
  requestedMode,
  originReceived,
  allowedOrigins,
}: {
  phase: Phase;
  seconds: number;
  sawAnyMessage: boolean;
  attempts: ExchangeAttempt[];
  requestedMode: AtlasSessionMode;
  originReceived: string | null;
  allowedOrigins: string[];
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
          An {ATLAS_MESSAGE_TYPE} message arrived from <strong>{originReceived}</strong>, which is
          not in the allowlist. Allowed:{' '}
          <strong>{allowedOrigins.length > 0 ? allowedOrigins.join(', ') : '(none configured)'}</strong>.
        </Alert>
      );
    case 'malformed':
      return (
        <Alert severity="error">
          <AlertTitle>Envelope does not match Contract B</AlertTitle>
          The message came from an allowed origin ({originReceived}) but its shape is not{' '}
          {'{ type, token, partner }'}.
        </Alert>
      );
    case 'exchanging':
      return (
        <Alert severity="info" icon={<CircularProgress size={20} />}>
          <AlertTitle>Envelope accepted</AlertTitle>
          Origin {originReceived} is allowed. Exchanging the token.
        </Alert>
      );
    case 'settled':
      return <SettledBanner attempts={attempts} requestedMode={requestedMode} />;
  }
}

function SettledBanner({
  attempts,
  requestedMode,
}: {
  attempts: ExchangeAttempt[];
  requestedMode: AtlasSessionMode;
}) {
  const primary = attempts.find((attempt) => !attempt.automatic) ?? attempts[0];
  const informational = attempts.find(
    (attempt) => attempt.response && isInformationalStage(attempt.response.stage)
  );
  const escalated = attempts.some((attempt) => attempt.automatic);

  // A stage flagged informational outranks the failure it arrived with: it is the
  // answer to "does the SSO work", and the answer is yes.
  if (informational?.response) {
    return (
      <Alert severity="info">
        <AlertTitle>The SSO works — this account has no partner attached</AlertTitle>
        {stageConclusion(informational.response.stage)} Sign-in did not complete, but the
        handshake, the token and the call to Atlas all did.
      </Alert>
    );
  }

  if (primary?.response?.ok) {
    return (
      <Alert severity="success">
        <AlertTitle>{requestedMode === 'login' ? 'Signed in' : 'Probe succeeded'}</AlertTitle>
        {requestedMode === 'login'
          ? 'A session cookie was issued. Redirecting…'
          : 'Atlas answered and the contract was exercised end to end. No session was issued.'}
      </Alert>
    );
  }

  const conclusion = primary?.response ? stageConclusion(primary.response.stage) : null;

  return (
    <Alert severity="error">
      <AlertTitle>Sign-in did not complete</AlertTitle>
      {conclusion ?? 'The envelope was accepted, but the session exchange failed.'}
      {escalated && ' A diagnostic probe was run automatically; its results are below.'}
    </Alert>
  );
}
