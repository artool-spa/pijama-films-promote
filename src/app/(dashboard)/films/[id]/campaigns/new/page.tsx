import { notFound, redirect } from 'next/navigation';
import { getFilmById } from '@/models/film';
import { getImagesByFilmMuviUuid } from '@/models/image';
import { getVideosByFilmMuviUuid } from '@/models/video';
import { syncMuviAssets } from '@/lib/assets';
import { getSession } from '@/lib/auth/session';
import { getPartnerByPartnerId } from '@/models/partner';
import { getAccountBalance } from '@/models/account';
import { getCampaignById } from '@/models/campaign';
import { getUserPreference } from '@/models/userPreference';
import CreateCampaignClient from './client';

export const dynamic = 'force-dynamic';

export default async function CreateCampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ draft?: string; payment?: string; session_id?: string }>;
}) {
  const { id } = await params;
  const { draft: draftId, payment, session_id } = await searchParams;
  const film = await getFilmById(id, false); // Don't need campaigns

  if (!film) {
    notFound();
  }

  // Fetch account balance for budget check and user preferences
  let initialBalance = 0;
  let howItWorksDismissed = false;
  const session = await getSession();
  if (session) {
    const partner = await getPartnerByPartnerId(session.partnerId);
    if (partner) {
      initialBalance = await getAccountBalance(partner.id);
    }
    const preference = await getUserPreference(session.email);
    if (preference) {
      howItWorksDismissed = preference.howItWorksDismissed;
    }
  }

  // Sync MUVI media assets to local DB (creates records synchronously, validation in background)
  if (film.mediaAssets && film.mediaAssets.length > 0) {
    await syncMuviAssets(film.mediaAssets, id);
  }

  // Fetch ALL assets from DB (includes both MUVI-synced and user-uploaded)
  const [dbImages, dbVideos] = await Promise.all([
    getImagesByFilmMuviUuid(id),
    getVideosByFilmMuviUuid(id),
  ]);

  console.log(`[Campaign New] Film ${id}: ${dbImages.length} images, ${dbVideos.length} videos from DB`);

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

  // Load existing draft if resuming
  let existingDraft = null;
  if (draftId) {
    const draft = await getCampaignById(draftId);
    if (draft && draft.status === 'DRAFT' && draft.filmMuviUuid === id) {
      existingDraft = draft;
    }
  }

  return (
    <CreateCampaignClient
      film={film}
      localImages={localImages}
      localVideos={localVideos}
      initialBalance={initialBalance}
      existingDraft={existingDraft}
      paymentStatus={payment}
      paymentSessionId={session_id}
      howItWorksDismissed={howItWorksDismissed}
    />
  );
}
