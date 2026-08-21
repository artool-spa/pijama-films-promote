import { notFound } from 'next/navigation';
import { getFilmById } from '@/models/film';
import { getCampaignById } from '@/models/campaign';
import { getImagesWithUsageByFilmMuviUuid } from '@/models/image';
import { getVideosWithUsageByFilmMuviUuid } from '@/models/video';
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

  // The ad media picker only ever offers the ad's own `adSetType`, so skip the
  // library the campaign cannot use. The route param is the film MUVI uuid.
  const needsImages = campaign.ads.some((ad) => ad.adSetType === 'IMAGE');
  const needsVideos = campaign.ads.some((ad) => ad.adSetType === 'VIDEO');
  const [images, videos] = await Promise.all([
    needsImages ? getImagesWithUsageByFilmMuviUuid(id) : Promise.resolve([]),
    needsVideos ? getVideosWithUsageByFilmMuviUuid(id) : Promise.resolve([]),
  ]);

  return (
    <CampaignEditClient
      film={film}
      campaign={campaign}
      images={images}
      videos={videos}
      focusSection={section === 'ad' ? 'ad' : null}
      focusAdId={adId ?? null}
    />
  );
}
