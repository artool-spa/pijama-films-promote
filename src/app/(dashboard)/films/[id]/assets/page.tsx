import { notFound, redirect } from 'next/navigation';
import { getFilmById } from '@/models/film';
import { getImagesWithUsageByFilmMuviUuid } from '@/models/image';
import { getVideosWithUsageByFilmMuviUuid } from '@/models/video';
import { syncMuviAssets } from '@/lib/assets';
import { getSession } from '@/lib/auth/session';
import AssetsClient from './client';

export default async function AssetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string; draft?: string }>;
}) {
  const { id } = await params;
  const { returnTo, draft } = await searchParams;
  const film = await getFilmById(id, false);

  if (!film) {
    notFound();
  }

  // Auth check
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  // Sync MUVI media assets to local DB (creates records synchronously, validation in background)
  if (film.mediaAssets && film.mediaAssets.length > 0) {
    await syncMuviAssets(film.mediaAssets, id);
  }

  // Fetch active and archived assets with usage counts
  const [images, videos, archivedImages, archivedVideos] = await Promise.all([
    getImagesWithUsageByFilmMuviUuid(id),
    getVideosWithUsageByFilmMuviUuid(id),
    getImagesWithUsageByFilmMuviUuid(id, true),
    getVideosWithUsageByFilmMuviUuid(id, true),
  ]);

  return (
    <AssetsClient
      film={film}
      images={images}
      videos={videos}
      archivedImages={archivedImages}
      archivedVideos={archivedVideos}
      returnTo={returnTo}
      draftId={draft}
    />
  );
}
