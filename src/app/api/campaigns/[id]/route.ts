import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import { getPartnerFromRequest, canManageCampaign } from '@/lib/auth';
import { getCampaignById, deleteCampaign } from '@/models/campaign';

/**
 * DELETE /api/campaigns/:id
 * Delete a draft campaign
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    // Verify campaign belongs to this partner
    const campaign = await getCampaignById(id);
    // 404 (not 403) for someone else's campaign: do not reveal that it exists.
    if (!campaign || !canManageCampaign(partner, campaign.partnerId).allowed) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    await deleteCampaign(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    logger.error({ err: error }, 'Error deleting campaign');
    const message = error instanceof Error ? error.message : 'Error deleting campaign';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
