import { notFound } from 'next/navigation';
import { getFilmById } from '@/models/film';
import { getImagesByFilmMuviUuid } from '@/models/image';
import { getVideosByFilmMuviUuid } from '@/models/video';
import { syncMuviAssetsInBackground } from '@/lib/assets';
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

  // Fetch local assets from database
  const [dbImages, dbVideos] = await Promise.all([
    getImagesByFilmMuviUuid(id),
    getVideosByFilmMuviUuid(id),
  ]);

  // Sync MUVI media assets to local DB in background (fire and forget)
  // This checks if assets already exist and only uploads new ones
  if (film.mediaAssets && film.mediaAssets.length > 0) {
    syncMuviAssetsInBackground(film.mediaAssets, id);
  }

  // Map database assets to the format expected by the client
  const localImages = dbImages.map((img) => ({
    id: img.id,
    type: 'image' as const,
    name: img.name,
    url: img.url,
    thumbnailUrl: img.url,
    storageKey: img.storageKey,
  }));

  const localVideos = dbVideos.map((vid) => ({
    id: vid.id,
    type: 'video' as const,
    name: vid.name,
    url: vid.url,
    thumbnailUrl: vid.thumbnailUrl || vid.url,
    storageKey: vid.storageKey,
    metaVideoId: vid.metaVideoId,
  }));

  return (
    <CreateCampaignClient
      film={film}
      localImages={localImages}
      localVideos={localVideos}
    />
  );
}
