# T-stage — header-safe token validation at `stage: 'input'`

Branch `fix/atlas-input-stage-header-safety`, based on `feat/atlas-sso` @ `5e3a6a3`.

## The defect

A user pasted a JavaScript fragment (with newlines) into the token field on `/auth`.
Measured response, reproduced twice by T0:

```
502 {"ok":false,"stage":"atlas_call",
     "message":"Atlas produced no HTTP response: TypeError: Headers.append:
                \"Bearer const r = await fetch(...)\nconsole.log(r)\" is an invalid header value."}
```

`/auth` derives its conclusion from `stage`, so it told the user *"Atlas could not be
reached at all."* Two defects in one envelope:

1. **We blamed the third party for our own validation hole.** This project exists to
   answer whether Atlas' SSO works. That envelope would have had us reporting a
   non-existent bug to Crazy Cake.
2. **The pasted value came back in full inside the message.** It was a script this
   time. Had it been a real token, it left in the HTTP response and in Cloud Logging.

Cause: `fetch` builds the `Authorization` header inside the client's `try`, so
`Headers.append` throwing is caught by the `catch` meant for transport failures and
becomes `networkError` → `stage: 'atlas_call'`.

## What `fetch` actually does — MEASURED, node 26.7 / undici, 2026-08-28

Real `fetch` to a dead port, varying only the `Authorization` value:

| value contains | outcome |
|---|---|
| LF, CR, NUL | `TypeError: Headers.append: "Bearer <THE WHOLE VALUE>" is an invalid header value` — **echoes the credential** |
| beyond U+00FF (emoji) | `TypeError: Cannot convert argument to a ByteString` |
| TAB, SPACE, DEL, VT, U+0080–U+00FF (`é`) | **accepted and actually sent upstream** |

So `fetch` is not a validator: it leaks on half of these and silently forwards the
other half. Both are ours to prevent before the request exists.

## The fix

`headerSafetyProblem(token)` in `src/lib/atlas/client.ts` — `null` when the value can
travel in a header, otherwise a message naming what is wrong.

- **Physical check only:** printable ASCII, no space (`/[^\x21-\x7E]/u`).
- **The token stays opaque.** No decoding, no three-segment JWT shape, no length floor.
  Whether the credential is valid is Atlas' answer to give. `basura-sin-saltos` still
  travels upstream and still reports whatever Atlas answered — that case is the control,
  and it is pinned by tests in both files.
- **Message masks the value:** class and index of the *first* offending character plus
  the fingerprint used everywhere else (length + 6-char prefix), with the prefix escaped
  so a raw control character cannot ride out in the response body. It never mentions
  Atlas — nothing was sent, so there is nothing to report about the upstream.

Two call sites, one predicate:

- `route.ts`, right after the Zod parse: `400 { stage: 'input' }`. Placed **before** the
  login pre-flight, so a malformed request reads as malformed even when
  `ATLAS_LOGIN_ENABLED=false`.
- `client.ts`, first thing in `fetchPartnerMovies` (before the base-URL check): returns
  `status: 0` with the new `inputError` field set and `networkError: null`. The client
  owns the header, so it owns the containment; any future caller is covered too.
  `route.ts` maps `call.inputError` → `stage: 'input'` as well, so `'atlas_call'` can
  never carry a fault of ours. That mapping is not dead code: mutation M1b below reaches it.

`AtlasCallResult` gains `inputError: string | null`. `AtlasSessionStage` is **unchanged** —
`'input'` already existed and is the right stage; the taxonomy needed no new value.

`/auth` was NOT touched (FX-envelope owns it). It already maps `stage: 'input'` to
*"Our own request was malformed. This is a bug on our side, not a problem with the
integration."* — the server fix flips the user-facing conclusion on its own.

## Tests — 40 new (155 in the Atlas suite, 547 / 40 files overall; base was 507)

Provenance, honestly split:

- **33 seen failing before the fix** (22 in `client.test.ts`, 11 in `session-route.test.ts`).
- **6 born green** — the controls: `basura-sin-saltos` reaching Atlas, a real JWT passing
  untouched, base64url / uuid-style / 4096-char tokens still forwarded, and the
  "no leak in logs" guard (global `fetch` is mocked in tests, so the real throw never
  happens there — it only guards regressions). These exist to fail if the validation ever
  becomes an opinion about token shape.
- **1 added after the fix** ("names a control character when that is the first thing
  wrong"), so never seen red pre-fix. Verified by mutation M3 instead.

One test expectation was wrong and the code was right: the pasted script trips on the
space in `const r` before it reaches the newline. The message names the *first* offender,
which is the more useful behaviour; the test was corrected, not the code.

## Mutation report — all three mandated mutants die

| # | Mutation | Result |
|---|---|---|
| M1a | `headerSafetyProblem` always returns `null` (kills both layers) | **DEAD** — 28 failed |
| M1b | remove **only** the route check | **DEAD** — 1 failed (`reports input before the login pre-flight`). The other DoD-1 route tests stay green: the client guard + `inputError` mapping still yield `stage: 'input'`. That is defence in depth doing its job, and it shows the mapping line is load-bearing. |
| M1c | remove **only** the client guard | **DEAD** — 4 failed (client-level containment) |
| M2 | harden to demand JWT shape (3 dot-separated segments) | **DEAD** — 7 failed, all controls: `basura-sin-saltos`, punctuation, single char, base64url, uuid, long token |
| M3 | stop masking — echo the value in the message | **DEAD** — 5 failed |

No surviving mutants.

## Verification

- `npx tsc --noEmit` — clean.
- `npx yarn@1.22.22 test --run` — 547 passed / 40 files.
- `npx yarn@1.22.22 lint` — 0 errors (4 pre-existing warnings in files not touched here).
- Not verified in a browser: this is a server-side change and `/auth` belongs to another
  agent. The UI consequence was verified by reading `STAGE_CONCLUSION` in
  `src/app/auth/atlas-bridge.ts` (read-only), which already carries the correct text for
  `input`.

## Observation for T0 — not changed, deliberately

`src/app/api/auth/atlas/session/route.ts` still reports a missing `ATLAS_API_BASE_URL`
as `stage: 'atlas_call'` (pinned by a pre-existing test, and documented as intentional in
the route header). That is also *our* fault being filed under the third party, so it is
the same class of defect as the one fixed here — but it is a configuration error, not
user input, and changing it would rewrite an existing decision plus its test. Flagged
rather than taken. DoD 5 as written ("`atlas_call` reserved for a genuine absence of an
HTTP response") is satisfied for every path a user can trigger.
