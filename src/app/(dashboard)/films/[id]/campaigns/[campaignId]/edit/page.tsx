import { notFound } from 'next/navigation';
import { getFilmById } from '@/models/film';
import { getCampaignById } from '@/models/campaign';
import CampaignEditClient from './client';

export default async function CampaignEditPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  const [film, campaign] = await Promise.all([
    getFilmById(id, false),
    getCampaignById(campaignId),
  ]);

  if (!film || !campaign) {
    notFound();
  }

  return <CampaignEditClient film={film} campaign={campaign} />;
}
