import { NextRequest, NextResponse } from 'next/server';
import { getPartnerFromRequest } from '@/lib/auth';
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
    if (!campaign) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }
    if (campaign.partnerId !== partner.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
    }

    await deleteCampaign(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    const message = error instanceof Error ? error.message : 'Error deleting campaign';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
