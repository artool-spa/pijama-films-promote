import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE_NAME = 'pijama-session';

/**
 * Signing key for session cookies. No fallback on purpose - see
 * `@/lib/auth/session`. Kept inline because the Edge runtime cannot import
 * the Node-only modules that file pulls in.
 */
function getSecretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;

  if (!secret || secret.length < 32) {
    throw new Error(
      'SESSION_SECRET is not configured (minimum 32 characters required)'
    );
  }

  return new TextEncoder().encode(secret);
}

// Routes this middleware does not gate on a session cookie.
//
// `/api/cron/` and `/api/internal/` are not public: they are called by Cloud
// Scheduler and Cloud Tasks, which present an OIDC token rather than a session,
// and each route authorizes that token itself via authorizeInternalRequest.
// Leaving either one out here means the middleware answers 401 before the route
// ever runs.
//
// `/api/webhooks/` is the same case with a different caller: Stripe posts from
// its own servers and carries no session cookie, so gating it here answered 401
// to every event before the handler ran. The route authorizes itself by
// verifying the HMAC signature against STRIPE_WEBHOOK_SECRET, which is a
// stronger check than a cookie.
//
// `/api/auth/atlas/` is the Atlas SSO exchange: it is called by the `/auth`
// landing page, which by definition has no session cookie yet, and it
// authorizes itself on Atlas' answer plus a partner allowlist.
const PUBLIC_ROUTES = [
  '/login',
  '/api/auth/login',
  '/api/auth/atlas/',
  '/api/cron/',
  '/api/internal/',
  '/api/webhooks/',
  '/privacy-policy',
  '/terms-of-service',
  '/auth',
];

// Routes matched EXACTLY, not by prefix, and never in production.
//
// The simulator posts a synthetic ATLAS_AUTH message at /auth so the SSO can be
// exercised without Crazy Cake. It is only reachable with no session - that is
// the whole scenario it covers - so the middleware has to let it through.
//
// Two properties of this list are load-bearing:
//
//  1. Exact match, not a '/dev/' entry in PUBLIC_ROUTES. That list is matched
//     with startsWith, so '/dev/' would publish every future route under /dev/
//     the moment someone adds one. A sub-route of the simulator needs its own
//     entry here - deliberately so; the next person should have to think.
//  2. Empty in production. "The simulator is unreachable in production" is a
//     two-layer contract: this guard, and the notFound() in the page itself
//     (src/app/dev/atlas-simulator/page.tsx). Neither layer may be removed on
//     the assumption that the other one holds.
const PUBLIC_EXACT_ROUTES = ['/dev/atlas-simulator'];

function isPublicExactRoute(pathname: string): boolean {
  if (process.env.NODE_ENV === 'production') return false;

  return PUBLIC_EXACT_ROUTES.includes(pathname);
}

// API routes that require authentication
const PROTECTED_API_PREFIX = '/api/';

// Headers a caller must never be able to supply, because something downstream
// treats them as authority. They are deleted from the cloned request headers
// before this middleware sets its own — see the comment at the deletion site.
//
// `x-partner-id` is here because it WAS an authority: it named the internal
// partner document id and getPartnerFromRequest preferred it over the
// session-derived header. The other two are set below from the verified session
// payload, so overwriting already protects them; they are deleted as well so
// that this list, rather than the ordering of the `set` calls further down, is
// what guarantees a caller cannot speak for the session.
const CALLER_FORBIDDEN_HEADERS = [
  'x-partner-id',
  'x-pijama-partner-id',
  'x-user-name',
] as const;

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const start = Date.now();

  // Allow public routes
  if (
    PUBLIC_ROUTES.some((route) => pathname.startsWith(route)) ||
    isPublicExactRoute(pathname)
  ) {
    return withRequestLog(request, NextResponse.next(), start);
  }

  // Allow static files and Next.js internals
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/favicon') ||
    pathname.includes('.')
  ) {
    return NextResponse.next();
  }

  // Check for session cookie
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME);

  if (!sessionCookie?.value) {
    // For API routes, return 401
    if (pathname.startsWith(PROTECTED_API_PREFIX)) {
      return withRequestLog(
        request,
        NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
        start
      );
    }
    // For pages, redirect to login
    return withRequestLog(
      request,
      NextResponse.redirect(new URL('/login', request.url)),
      start
    );
  }

  // Verify session token
  try {
    const { payload } = await jwtVerify(sessionCookie.value, getSecretKey());

    // Pass partner info to route handlers as *request* headers. Setting them
    // on the response would also work (Next copies those onto the request) but
    // would additionally ship the partner id and user name to the browser.
    //
    // The incoming headers must be cloned: Next deletes every request header
    // absent from the override set, so building a fresh Headers() here would
    // strip the cookie, user-agent and everything else.
    const requestHeaders = new Headers(request.headers);

    // Strip the headers this middleware is the sole authority for, BEFORE
    // setting our own. The clone above carries the caller's headers verbatim,
    // so a header we overwrite is safe and a header we merely forget is not.
    //
    // `x-partner-id` is the one that mattered: getPartnerFromRequest used to
    // read it in preference to the session-derived id set below, and nothing
    // but a caller ever produced it, so one request header turned any session
    // into any partner — including `pijamafilms`, which is granted unrestricted
    // access by design. That read is gone; deleting the header here makes it
    // unreachable as well, so reintroducing the read cannot on its own reopen
    // the hole. Deleting is not the same as overwriting: `x-partner-id` has no
    // session-derived value to overwrite it with.
    for (const header of CALLER_FORBIDDEN_HEADERS) {
      requestHeaders.delete(header);
    }

    requestHeaders.set('x-pijama-partner-id', payload.partnerId as string);
    requestHeaders.set('x-user-name', payload.name as string);
    requestHeaders.set('x-request-path', pathname);
    requestHeaders.set('x-request-method', request.method);

    const response = NextResponse.next({ request: { headers: requestHeaders } });

    return withRequestLog(request, response, start);
  } catch {
    // Invalid token - clear cookie and redirect
    const response = pathname.startsWith(PROTECTED_API_PREFIX)
      ? NextResponse.json({ error: 'Invalid session' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', request.url));

    response.cookies.delete(SESSION_COOKIE_NAME);
    return withRequestLog(request, response, start);
  }
}

/**
 * Log the request using structured JSON (Edge Runtime compatible).
 * Pino can't run in Edge Runtime due to worker threads, so we write
 * structured JSON directly to stdout matching pino's format.
 *
 * Note: `status` reflects the middleware decision (200=pass-through,
 * 401=unauthorized, 302=redirect). The final response status (e.g. 404
 * from notFound()) is determined later by the route handler.
 */
function withRequestLog(
  request: NextRequest,
  response: NextResponse,
  start: number
): NextResponse {
  const duration = Date.now() - start;
  const status = response.status;
  const method = request.method;
  const path = request.nextUrl.pathname;

  if (process.env.NODE_ENV === 'production') {
    console.log(
      JSON.stringify({
        level: status >= 400 ? 40 : 30,
        time: Date.now(),
        module: 'http',
        method,
        path,
        status,
        duration,
      })
    );
  } else {
    const color = status >= 400 ? '\x1b[31m' : '\x1b[32m';
    const reset = '\x1b[0m';
    console.log(`${color}${method}${reset} ${path} ${color}${status}${reset} ${duration}ms`);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
