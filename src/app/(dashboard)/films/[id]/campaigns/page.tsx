import { notFound } from 'next/navigation';
import { getFilmById } from '@/models/film';
import FilmCampaignsClient from './client';

export default async function FilmCampaignsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const film = await getFilmById(id);

  if (!film) {
    notFound();
  }

  return <FilmCampaignsClient film={film} />;
}
