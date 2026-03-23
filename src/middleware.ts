import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE_NAME = 'pijama-session';
const SECRET_KEY = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'pijama-films-temporal-secret-key-2026'
);

// Routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/api/auth/login', '/privacy-policy', '/terms-of-service', '/auth'];

// API routes that require authentication
const PROTECTED_API_PREFIX = '/api/';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const start = Date.now();

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
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
    const { payload } = await jwtVerify(sessionCookie.value, SECRET_KEY);

    // Add partner info to headers for API routes
    const response = NextResponse.next();
    response.headers.set('x-pijama-partner-id', payload.partnerId as string);
    response.headers.set('x-user-name', payload.name as string);

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
