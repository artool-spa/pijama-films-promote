import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { validateCredentials } from '@/lib/auth/temporal-users';
import { createSessionToken, setSessionCookie } from '@/lib/auth/session';

const loginSchema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(1, 'Password required'),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const parsed = loginSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const { username, password } = parsed.data;
    const user = validateCredentials(username, password);

    if (!user) {
      return NextResponse.json(
        { error: 'Invalid username or password' },
        { status: 401 }
      );
    }

    // Create session token
    const token = await createSessionToken({
      username: user.username,
      name: user.name,
      partnerId: user.partnerId,
    });

    // Set session cookie
    await setSessionCookie(token);

    return NextResponse.json({
      success: true,
      user: {
        username: user.username,
        name: user.name,
        partnerId: user.partnerId,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
