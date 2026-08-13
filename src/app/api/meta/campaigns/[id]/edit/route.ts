import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import logger from '@/lib/logger';
import { getCampaignById, updateCampaignBudgetAndEndDate } from '@/models/campaign';
import { getPartnerFromRequest } from '@/lib/auth';
import { meta, updateCampaign as metaUpdateCampaign, updateAdSet as metaUpdateAdSet } from '#meta';
import { google, updateCampaignBudget as googleUpdateCampaignBudget, updateCampaignEndDate as googleUpdateCampaignEndDate } from '#google';

type RouteParams = { params: Promise<{ id: string }> };

const EditPayloadSchema = z
  .object({
    budget: z.number().positive().optional(),
    endDate: z.coerce.date().nullable().optional(),
  })
  .strict()
  .refine((v) => v.budget !== undefined || v.endDate !== undefined, {
    message: 'At least one of budget or endDate must be provided',
  });

/**
 * PATCH /api/meta/campaigns/[id]/edit
 *
 * Update campaign budget and/or end date. Persists locally, then pushes the
 * change to Meta (Campaign budget + AdSets' end_time) and Google (Campaign
 * budget + Campaign endDate).
 */
export async function PATCH(req: NextRequest, { params }: RouteParams) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await req.json();

    const parsed = EditPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Invalid data', details: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const before = await getCampaignById(id);
    if (!before) {
      return NextResponse.json({ error: 'Campaign not found' }, { status: 404 });
    }

    // 1) Save locally.
    const saved = await updateCampaignBudgetAndEndDate(id, {
      budget: parsed.data.budget,
      endDate: parsed.data.endDate ?? undefined,
    });

    const warnings: string[] = [];

    // 2) Push to Meta.
    if (before.metaCampaignId) {
      try {
        if (parsed.data.budget !== undefined) {
          // Meta expects budget in cents for USD accounts.
          const budgetCents = Math.round(parsed.data.budget * 100);
          if (before.budgetType === 'DAILY') {
            await metaUpdateCampaign(meta, before.metaCampaignId, { daily_budget: budgetCents });
          } else {
            await metaUpdateCampaign(meta, before.metaCampaignId, { lifetime_budget: budgetCents });
          }
        }
        if (parsed.data.endDate !== undefined) {
          const endTime = parsed.data.endDate ? parsed.data.endDate.toISOString() : undefined;
          if (before.imageAdSetId && endTime) {
            await metaUpdateAdSet(meta, before.imageAdSetId, { end_time: endTime });
          }
          if (before.videoAdSetId && endTime) {
            await metaUpdateAdSet(meta, before.videoAdSetId, { end_time: endTime });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown Meta update error';
        logger.error({ err, campaignId: id }, 'Meta campaign edit push failed');
        warnings.push(`Meta: ${msg}`);
      }
    }

    // 3) Push to Google.
    if (before.googleCampaignId) {
      try {
        if (parsed.data.budget !== undefined) {
          const amountMicros = BigInt(Math.round(parsed.data.budget * 1_000_000));
          await googleUpdateCampaignBudget(google, before.googleCampaignId, amountMicros);
        }
        if (parsed.data.endDate !== undefined) {
          const iso = parsed.data.endDate ? parsed.data.endDate.toISOString().slice(0, 10) : null;
          await googleUpdateCampaignEndDate(google, before.googleCampaignId, iso);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown Google update error';
        logger.error({ err, campaignId: id }, 'Google campaign edit push failed');
        warnings.push(`Google: ${msg}`);
      }
    }

    return NextResponse.json({ campaign: saved, warnings });
  } catch (error) {
    logger.error({ err: error }, 'Error editing campaign');
    return NextResponse.json({ error: 'Error editing campaign' }, { status: 500 });
  }
}
