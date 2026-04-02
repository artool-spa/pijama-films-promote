import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import {
  getAllPartners,
  createPartner,
  getOrCreatePartner,
  PartnerCreateSchema,
} from '@/models/partner';
import { getPartnerFromRequest } from '@/lib/auth';

/**
 * GET /api/partners
 * List all partners
 */
export async function GET(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const partners = await getAllPartners();
    return NextResponse.json(partners);
  } catch (error) {
    logger.error({ err: error }, 'Error fetching partners');
    return NextResponse.json(
      { error: 'Error al obtener los partners' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/partners
 * Create a new partner or get existing one by Pijama partner ID
 */
export async function POST(req: NextRequest) {
  const authenticatedPartner = await getPartnerFromRequest(req);
  if (!authenticatedPartner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await req.json();

    // If partnerId is provided, use getOrCreate
    if (body.partnerId && body.name) {
      const partner = await getOrCreatePartner(body.partnerId, body.name);
      return NextResponse.json(partner, { status: 200 });
    }

    // Otherwise, validate and create new partner
    const result = PartnerCreateSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const partner = await createPartner(result.data);
    return NextResponse.json(partner, { status: 201 });
  } catch (error) {
    logger.error({ err: error }, 'Error creating partner');
    return NextResponse.json(
      { error: 'Error al crear el partner' },
      { status: 500 }
    );
  }
}
