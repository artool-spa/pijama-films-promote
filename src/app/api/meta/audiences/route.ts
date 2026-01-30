import { NextRequest, NextResponse } from 'next/server';
import { meta, getSavedAudiences, getAllSavedAudiences, MetaApiError } from '#meta';
import { getPartnerFromRequest } from '@/lib/auth';

/**
 * GET /api/meta/audiences
 * List all saved audiences from the Meta Ads account
 *
 * Query params:
 * - all=true: Fetch all audiences (handles pagination)
 * - limit: Number of audiences per page (default 50)
 * - after: Pagination cursor
 */
export async function GET(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);

  const fetchAll = searchParams.get('all') === 'true';
  const limit = parseInt(searchParams.get('limit') || '50', 10);
  const after = searchParams.get('after') || undefined;

  try {
    if (fetchAll) {
      const audiences = await getAllSavedAudiences(meta);

      return NextResponse.json({
        data: audiences,
        total: audiences.length,
      });
    }

    const response = await getSavedAudiences(meta, { limit, after });

    return NextResponse.json({
      data: response.data,
      paging: response.paging,
      total: response.data.length,
    });
  } catch (error) {
    console.error('Error fetching saved audiences:', error);

    if (error instanceof MetaApiError) {
      return NextResponse.json(
        {
          error: 'Error al obtener audiencias de Meta',
          details: error.message,
          code: error.errorCode,
        },
        { status: 502 }
      );
    }

    return NextResponse.json(
      { error: 'Error al obtener audiencias guardadas' },
      { status: 500 }
    );
  }
}
