import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const queryParams = Object.fromEntries(searchParams.entries());

  console.log('[AUTH GET] Query params:', JSON.stringify(queryParams, null, 2));
  console.log('[AUTH GET] Headers:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2));
  console.log('[AUTH GET] URL:', req.nextUrl.toString());

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

  console.log('[AUTH POST] Query params:', JSON.stringify(queryParams, null, 2));
  console.log('[AUTH POST] Body:', JSON.stringify(body, null, 2));
  console.log('[AUTH POST] Headers:', JSON.stringify(Object.fromEntries(req.headers.entries()), null, 2));
  console.log('[AUTH POST] URL:', req.nextUrl.toString());

  return NextResponse.json({ error: 'Not found' }, { status: 404 });
}
