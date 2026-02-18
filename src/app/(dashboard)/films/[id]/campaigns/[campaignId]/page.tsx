import { notFound, redirect } from 'next/navigation';
import { getFilmById } from '@/models/film';
import { getCampaignById } from '@/models/campaign';
import CampaignDetailClient from './client';

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string; campaignId: string }>;
}) {
  const { id, campaignId } = await params;
  const film = await getFilmById(id, false); // Don't need campaigns for the film here
  const campaign = await getCampaignById(campaignId);

  if (!film || !campaign) {
    notFound();
  }

  if (campaign.status === 'DRAFT') {
    redirect(`/films/${id}/campaigns/new?draft=${campaignId}`);
  }

  return <CampaignDetailClient film={film} campaign={campaign} />;
}
