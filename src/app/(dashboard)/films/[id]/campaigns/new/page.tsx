import { notFound } from 'next/navigation';
import { getFilmById } from '@/models/film';
import { getImagesByFilmMuviUuid } from '@/models/image';
import { getVideosByFilmMuviUuid } from '@/models/video';
import { syncMuviAssets } from '@/lib/assets';
import CreateCampaignClient from './client';

export default async function CreateCampaignPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const film = await getFilmById(id, false); // Don't need campaigns

  if (!film) {
    notFound();
  }

  // Sync MUVI media assets to local DB (creates records synchronously, validation in background)
  // This returns existing assets or creates new ones with PENDING status
  let dbImages;
  let dbVideos;

  if (film.mediaAssets && film.mediaAssets.length > 0) {
    const synced = await syncMuviAssets(film.mediaAssets, id);
    dbImages = synced.images;
    dbVideos = synced.videos;
  } else {
    // No MUVI assets, fetch any existing assets from DB
    [dbImages, dbVideos] = await Promise.all([
      getImagesByFilmMuviUuid(id),
      getVideosByFilmMuviUuid(id),
    ]);
  }

  // Map database assets to the format expected by the client
  // Include all validation fields
  const localImages = dbImages.map((img) => ({
    id: img.id,
    type: 'image' as const,
    name: img.name,
    url: img.url,
    thumbnailUrl: img.url,
    storageKey: img.storageKey,
    // Validation fields
    status: img.status,
    validationError: img.validationError,
    aspectRatio: img.aspectRatio,
    facebookEligible: img.facebookEligible,
    instagramEligible: img.instagramEligible,
    eligibilityError: img.eligibilityError,
  }));

  const localVideos = dbVideos.map((vid) => ({
    id: vid.id,
    type: 'video' as const,
    name: vid.name,
    url: vid.url,
    thumbnailUrl: vid.thumbnailUrl || vid.url,
    storageKey: vid.storageKey,
    metaVideoId: vid.metaVideoId,
    // Validation fields
    status: vid.status,
    validationError: vid.validationError,
    aspectRatio: vid.aspectRatio,
    facebookEligible: vid.facebookEligible,
    instagramEligible: vid.instagramEligible,
    eligibilityError: vid.eligibilityError,
  }));

  return (
    <CreateCampaignClient
      film={film}
      localImages={localImages}
      localVideos={localVideos}
    />
  );
}
