import { NextRequest, NextResponse } from 'next/server';
import { createAd, AdCreateSchema } from '@/models/ad';
import { getPartnerFromRequest } from '@/lib/auth';

/**
 * POST /api/meta/ads
 * Create a new ad
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await req.json();

    const result = AdCreateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const ad = await createAd(result.data);

    return NextResponse.json(ad, { status: 201 });
  } catch (error) {
    console.error('Error creating ad:', error);
    return NextResponse.json(
      { error: 'Error al crear el anuncio' },
      { status: 500 }
    );
  }
}
