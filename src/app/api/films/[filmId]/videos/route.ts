import { NextRequest, NextResponse } from 'next/server';
import type { AssetStatus } from '@/lib/assets/status';
import logger from '@/lib/logger';
import { getVideosByFilmMuviUuid, getVideosByFilmMuviUuidWithStatus } from '@/models/video';
import { getPartnerFromRequest } from '@/lib/auth';
import { assertFilmAccessible, filmAccessResponse } from '@/lib/assets/film-access';

type RouteParams = { params: Promise<{ filmId: string }> };

/**
 * GET /api/films/[filmId]/videos
 * Get all videos for a film
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
    await assertFilmAccessible(filmId);
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get('status');

    let videos;
    if (statusParam && isValidAssetStatus(statusParam)) {
      videos = await getVideosByFilmMuviUuidWithStatus(filmId, statusParam);
    } else {
      videos = await getVideosByFilmMuviUuid(filmId);
    }

    return NextResponse.json(videos);
  } catch (error) {
    const denied = filmAccessResponse(error);
    if (denied) return denied;

    logger.error({ err: error }, 'Error fetching videos');
    return NextResponse.json(
      { error: 'Error fetching videos' },
      { status: 500 }
    );
  }
}

function isValidAssetStatus(status: string): status is AssetStatus {
  return ['PENDING', 'VALIDATING', 'READY', 'INVALID', 'ERROR'].includes(status);
}
