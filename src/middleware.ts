import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const SESSION_COOKIE_NAME = 'pijama-session';
const SECRET_KEY = new TextEncoder().encode(
  process.env.SESSION_SECRET || 'pijama-films-temporal-secret-key-2026'
);

// Routes that don't require authentication
const PUBLIC_ROUTES = ['/login', '/api/auth/login', '/privacy-policy', '/terms-of-service'];

// API routes that require authentication
const PROTECTED_API_PREFIX = '/api/';

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    return NextResponse.next();
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
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    // For pages, redirect to login
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Verify session token
  try {
    const { payload } = await jwtVerify(sessionCookie.value, SECRET_KEY);

    // Add partner info to headers for API routes
    const response = NextResponse.next();
    response.headers.set('x-pijama-partner-id', payload.partnerId as string);
    response.headers.set('x-user-name', payload.name as string);

    return response;
  } catch {
    // Invalid token - clear cookie and redirect
    const response = pathname.startsWith(PROTECTED_API_PREFIX)
      ? NextResponse.json({ error: 'Invalid session' }, { status: 401 })
      : NextResponse.redirect(new URL('/login', request.url));

    response.cookies.delete(SESSION_COOKIE_NAME);
    return response;
  }
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
