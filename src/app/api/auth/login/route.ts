import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { verifyIdToken } from '@/lib/firebase/admin';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';
import logger from '@/lib/logger';

const loginSchema = z.object({
  idToken: z.string().min(1, 'ID token required'),
});

/**
 * POST /api/auth/login
 *
 * The browser authenticates against Firebase Auth and posts the resulting ID
 * token here. We verify it server-side and exchange it for our own signed
 * session cookie, which is what the middleware and server components read.
 *
 * Passwords never reach this server.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid data' }, { status: 400 });
    }

    const user = await verifyIdToken(parsed.data.idToken);

    if (!user) {
      // Covers invalid/expired/revoked tokens and users missing the
      // partnerId claim. Deliberately vague so we don't leak which one.
      return NextResponse.json(
        { error: 'Invalid or unauthorized credentials' },
        { status: 401 }
      );
    }

    const token = await createSessionToken({
      uid: user.uid,
      email: user.email,
      name: user.name,
      partnerId: user.partnerId,
    });

    await setSessionCookie(token);

    return NextResponse.json({
      success: true,
      user: {
        email: user.email,
        name: user.name,
        partnerId: user.partnerId,
      },
    });
  } catch (error) {
    logger.error({ err: error }, 'Login failed');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
