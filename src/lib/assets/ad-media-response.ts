import { NextResponse } from 'next/server';
import { AdMediaError } from '@/models/ad';

/**
 * For a route's catch block: the HTTP answer for an ad whose media is not the
 * film's, or null for any other error. 400 with ONE message for "does not
 * exist" and "belongs to another film", so ids cannot be probed.
 */
export function adMediaResponse(error: unknown): NextResponse | null {
  if (!(error instanceof AdMediaError)) return null;

  return NextResponse.json({ error: error.message }, { status: 400 });
}
