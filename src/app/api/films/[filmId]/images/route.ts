import { NextRequest, NextResponse } from 'next/server';
import { AssetStatus } from '@prisma/client';
import { getImagesByFilmMuviUuid, getImagesByFilmMuviUuidWithStatus } from '@/models/image';
import { getPartnerFromRequest } from '@/lib/auth';

type RouteParams = { params: Promise<{ filmId: string }> };

/**
 * GET /api/films/[filmId]/images
 * Get all images for a film
 * Query params:
 *   - status: Filter by asset status (PENDING, VALIDATING, READY, INVALID, ERROR)
 */
export async function GET(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { filmId } = await params;
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');

    let images;
    if (statusParam && isValidAssetStatus(statusParam)) {
      images = await getImagesByFilmMuviUuidWithStatus(filmId, statusParam);
    } else {
      images = await getImagesByFilmMuviUuid(filmId);
    }

    return NextResponse.json(images);
  } catch (error) {
    console.error('Error fetching images:', error);
    return NextResponse.json(
      { error: 'Error fetching images' },
      { status: 500 }
    );
  }
}

function isValidAssetStatus(status: string): status is AssetStatus {
  return ['PENDING', 'VALIDATING', 'READY', 'INVALID', 'ERROR'].includes(status);
}
