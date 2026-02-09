import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getPartnerFromRequest } from '@/lib/auth';
import { saveDraftCampaign, updateCampaign } from '@/models/campaign';

const DraftSaveSchema = z.object({
  draftId: z.string().cuid().optional(),
  campaignData: z.object({
    name: z.string().min(1).max(255),
    budget: z.number().nonnegative(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    targetCountries: z.array(z.string()).default(['US']),
    targetAgeMin: z.number().int().min(13).max(65).default(18),
    targetAgeMax: z.number().int().min(13).max(65).default(65),
    targetGenders: z.array(z.number().int()).default([]),
    includeBaseAudiences: z.boolean().default(true),
    filmGenres: z.array(z.string()).default([]),
    includeLgbtAudience: z.boolean().default(false),
    filmMuviUuid: z.string().min(1),
    platforms: z.array(z.enum(['META', 'GOOGLE'])).min(1).default(['META']),
    language: z.string().min(2).max(10).default('es'),
  }),
  formState: z.unknown(),
});

/**
 * POST /api/campaigns/draft
 * Save or update a draft campaign with serialized form state
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const result = DraftSaveSchema.safeParse(body);

    if (!result.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { draftId, campaignData, formState } = result.data;

    if (draftId) {
      // Update existing draft
      const updated = await updateCampaign(draftId, {
        name: campaignData.name,
        budget: campaignData.budget || undefined,
        endDate: campaignData.endDate,
        targetCountries: campaignData.targetCountries,
        targetAgeMin: campaignData.targetAgeMin,
        targetAgeMax: campaignData.targetAgeMax,
        targetGenders: campaignData.targetGenders,
        includeBaseAudiences: campaignData.includeBaseAudiences,
        filmGenres: campaignData.filmGenres,
        includeLgbtAudience: campaignData.includeLgbtAudience,
        language: campaignData.language,
        draftFormState: formState,
      });

      return NextResponse.json({ campaign: { id: updated.id } });
    }

    // Create new draft
    const campaign = await saveDraftCampaign({
      name: campaignData.name,
      objective: 'LANDING_PAGE_VIEW',
      budget: campaignData.budget || 1, // Minimum positive for schema validation
      budgetType: 'LIFETIME',
      conversionEvent: 'PURCHASE',
      startDate: campaignData.startDate,
      endDate: campaignData.endDate,
      targetCountries: campaignData.targetCountries,
      targetAgeMin: campaignData.targetAgeMin,
      targetAgeMax: campaignData.targetAgeMax,
      targetGenders: campaignData.targetGenders,
      includeBaseAudiences: campaignData.includeBaseAudiences,
      filmGenres: campaignData.filmGenres,
      includeLgbtAudience: campaignData.includeLgbtAudience,
      filmMuviUuid: campaignData.filmMuviUuid,
      partnerId: partner.id,
      platforms: campaignData.platforms,
      language: campaignData.language,
      draftFormState: formState,
    });

    return NextResponse.json({ campaign: { id: campaign.id } }, { status: 201 });
  } catch (error) {
    console.error('Error saving draft campaign:', error);
    return NextResponse.json(
      { error: 'Error saving draft' },
      { status: 500 }
    );
  }
}
