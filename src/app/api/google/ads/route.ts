import { NextRequest, NextResponse } from 'next/server';
import { createAd } from '@/models/ad';
import { AdCreateSchema } from '@/models/ad';
import { getPartnerFromRequest } from '@/lib/auth';

/**
 * POST /api/google/ads
 * Create a Google ad locally (DRAFT status)
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
        { error: 'Datos invalidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const ad = await createAd(result.data);

    return NextResponse.json({ success: true, ad }, { status: 201 });
  } catch (error) {
    console.error('Error creating Google ad:', error);
    return NextResponse.json(
      { error: 'Error al crear el anuncio' },
      { status: 500 }
    );
  }
}
