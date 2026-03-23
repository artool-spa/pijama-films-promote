import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const queryParams = Object.fromEntries(searchParams.entries());

  logger.info({ queryParams, url: req.nextUrl.toString() }, 'AUTH GET');

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}

export async function POST(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const queryParams = Object.fromEntries(searchParams.entries());

  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    // Body may not be JSON
  }

  logger.info({ queryParams, body, url: req.nextUrl.toString() }, 'AUTH POST');

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
