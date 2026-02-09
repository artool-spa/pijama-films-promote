import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { dismissHowItWorks } from '@/models/userPreference';

/**
 * PATCH /api/user-preferences/how-it-works
 * Dismiss the "How it Works" modal for the authenticated user
 */
export async function PATCH() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await dismissHowItWorks(session.email);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error dismissing How it Works:', error);
    return NextResponse.json(
      { error: 'Error updating preference' },
      { status: 500 }
    );
  }
}
