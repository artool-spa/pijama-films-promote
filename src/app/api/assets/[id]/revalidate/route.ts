import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPartnerFromRequest } from '@/lib/auth';
import { revalidateAsset } from '@/lib/assets';
import { getImageById } from '@/models/image';
import { getVideoById } from '@/models/video';

type RouteParams = { params: Promise<{ id: string }> };

const RevalidateRequestSchema = z.object({
  type: z.enum(['image', 'video']),
  filmMuviUuid: z.string().min(1),
});

/**
 * POST /api/assets/[id]/revalidate
 * Trigger re-validation for a failed asset
 */
export async function POST(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json();
    const { type, filmMuviUuid } = RevalidateRequestSchema.parse(body);

    // Verify the asset exists
    if (type === 'image') {
      const image = await getImageById(id);
      if (!image) {
        return NextResponse.json({ error: 'Image not found' }, { status: 404 });
      }
      if (image.filmMuviUuid !== filmMuviUuid) {
        return NextResponse.json({ error: 'Asset does not belong to this film' }, { status: 403 });
      }
    } else {
      const video = await getVideoById(id);
      if (!video) {
        return NextResponse.json({ error: 'Video not found' }, { status: 404 });
      }
      if (video.filmMuviUuid !== filmMuviUuid) {
        return NextResponse.json({ error: 'Asset does not belong to this film' }, { status: 403 });
      }
    }

    // Trigger revalidation in background
    await revalidateAsset(id, type, filmMuviUuid);

    return NextResponse.json({
      success: true,
      message: 'Revalidation started',
    });
  } catch (error) {
    console.error('Error triggering revalidation:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid request', details: error.errors },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Error triggering revalidation' },
      { status: 500 }
    );
  }
}
