import { notFound } from 'next/navigation';
import { getFilmById } from '@/models/film';
import { getCampaignById } from '@/models/campaign';
import CampaignEditClient from './client';

export default async function CampaignEditPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; campaignId: string }>;
  searchParams: Promise<{ section?: string; adId?: string }>;
}) {
  const { id, campaignId } = await params;
  const { section, adId } = await searchParams;
  const [film, campaign] = await Promise.all([
    getFilmById(id, false),
    getCampaignById(campaignId),
  ]);

  if (!film || !campaign) {
    notFound();
  }

  return (
    <CampaignEditClient
      film={film}
      campaign={campaign}
      focusSection={section === 'ad' ? 'ad' : null}
      focusAdId={adId ?? null}
    />
  );
}
