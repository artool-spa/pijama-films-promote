import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignEditClient from '../client';
import type { Film } from '@/models/film';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';
import type { ImageWithUsage } from '@/models/image';
import type { VideoWithUsage } from '@/models/video';

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

type CampaignAd = CampaignWithPartnerAndAds['ads'][number];

const film = { id: 'film-1', title: 'The Long Summer' } as unknown as Film;

const AD_IMAGE = {
  id: 'img-1',
  name: 'Poster',
  url: 'https://cdn.test/poster.jpg',
  aspectRatio: '1.91:1',
};

function makeAd(overrides: Partial<CampaignAd> = {}): CampaignAd {
  return {
    id: 'ad-1',
    metaAdId: 'meta-123',
    googleAdId: null,
    youtubeAdFormat: null,
    name: 'The Long Summer - ES',
    adSetType: 'IMAGE',
    headlines: ['Watch the film'],
    bodies: ['A quiet story about a long summer.'],
    descriptions: ['Rent it tonight'],
    callToAction: 'WATCH_MORE',
    linkUrl: 'https://pijama.film/films/film-1',
    images: [AD_IMAGE],
    videos: [],
    approvalStatus: 'APPROVED',
    rejectionReason: null,
    suggestedCorrection: null,
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as unknown as CampaignAd;
}

function makeCampaign(
  ads: CampaignAd[],
  overrides: Partial<CampaignWithPartnerAndAds> = {}
): CampaignWithPartnerAndAds {
  return {
    id: 'campaign-1',
    name: 'Summer launch',
    budget: 25,
    budgetType: 'DAILY',
    endDate: null,
    platforms: ['META'],
    ads,
    partner: { id: 'p1', name: 'Pijama Films' },
    ...overrides,
  } as unknown as CampaignWithPartnerAndAds;
}

function makeImage(overrides: Partial<ImageWithUsage> = {}): ImageWithUsage {
  return {
    id: 'img-1',
    filmMuviUuid: 'film-1',
    name: 'Poster',
    url: 'https://cdn.test/poster.jpg',
    status: 'READY',
    aspectRatio: '1.91:1',
    archived: false,
    validationError: null,
    facebookEligible: true,
    instagramEligible: true,
    googleEligible: true,
    _count: { ads: 1 },
    ...overrides,
  } as unknown as ImageWithUsage;
}

function makeVideo(overrides: Partial<VideoWithUsage> = {}): VideoWithUsage {
  return {
    id: 'vid-1',
    filmMuviUuid: 'film-1',
    name: 'Trailer',
    url: 'https://cdn.test/trailer.mp4',
    thumbnailUrl: 'https://cdn.test/trailer.jpg',
    metaVideoId: 'meta-video-1',
    status: 'READY',
    aspectRatio: '16:9',
    archived: false,
    validationError: null,
    facebookEligible: true,
    instagramEligible: true,
    _count: { ads: 1 },
    ...overrides,
  } as unknown as VideoWithUsage;
}

function renderPage(
  campaign: CampaignWithPartnerAndAds,
  props: {
    focusSection?: 'ad' | null;
    focusAdId?: string | null;
    images?: ImageWithUsage[];
    videos?: VideoWithUsage[];
  } = {}
) {
  render(
    <CampaignEditClient
      film={film}
      campaign={campaign}
      images={props.images ?? [makeImage(), makeImage({ id: 'img-2', name: 'Still' })]}
      videos={props.videos ?? []}
      focusSection={props.focusSection ?? null}
      focusAdId={props.focusAdId ?? null}
    />
  );
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
}

/** The fixture has media and copy, so the preview fires on its own. */
function callsTo(url: string) {
  return (global.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(
    ([called]) => String(called) === url
  );
}

const adPatchCalls = () => callsTo('/api/meta/ads/ad-1');
const previewCalls = () => callsTo('/api/meta/preview');

/** Toggle an asset card's checkbox in the media picker. */
function toggleAsset(assetId: string) {
  const card = document.querySelector(`[data-testid="asset-${assetId}"]`);
  if (!card) throw new Error(`No asset card for ${assetId}`);
  const checkbox = card.querySelector('input[type="checkbox"]') as HTMLInputElement;
  fireEvent.click(checkbox);
}

/**
 * Submit the form owning a button. Clicking the campaign submit button is not
 * enough under happy-dom: it reports a spurious `stepMismatch` on the
 * `step={0.01}` budget input, which real browsers accept via floating-point
 * tolerance, and that blocks implicit submission.
 */
function submitFormOf(buttonName: string) {
  const form = screen.getByRole('button', { name: buttonName }).closest('form');
  if (!form) throw new Error(`No form around "${buttonName}"`);
  fireEvent.submit(form);
}

describe('CampaignEditClient', () => {
  beforeEach(() => {
    push.mockClear();
    refresh.mockClear();
    global.fetch = vi.fn(async (url: RequestInfo | URL) =>
      String(url).startsWith('/api/meta/preview')
        ? jsonResponse({ preview: '<iframe src="https://www.facebook.com/preview?a=1&amp;b=2"></iframe>' })
        : jsonResponse({ warnings: [] })
    );
    // happy-dom does not implement scrollIntoView.
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders both cards for a campaign with one ad', () => {
    renderPage(makeCampaign([makeAd()]));

    expect(screen.getByRole('heading', { name: 'Campaign settings' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Ad content' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save campaign settings' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save ad content' })).toBeTruthy();
    // No ad picker for a single ad.
    expect(screen.queryByRole('tab')).toBeNull();
  });

  it('shows an empty state and no form when the campaign has no ads', () => {
    renderPage(makeCampaign([]));

    expect(screen.getByText('This campaign has no ads yet.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save ad content' })).toBeNull();
  });

  it('sends only the changed campaign fields', async () => {
    renderPage(makeCampaign([makeAd()]));

    fireEvent.change(screen.getByLabelText(/budget/i), { target: { value: '40' } });
    submitFormOf('Save campaign settings');

    const campaignCalls = () => callsTo('/api/meta/campaigns/campaign-1/edit');
    await waitFor(() => expect(campaignCalls()).toHaveLength(1));
    const [, init] = campaignCalls()[0];
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ budget: 40 });
    expect(refresh).toHaveBeenCalled();
  });

  it('does not call the API when nothing changed', async () => {
    renderPage(makeCampaign([makeAd()]));

    submitFormOf('Save campaign settings');

    await waitFor(() => expect(screen.getByText('No changes to save')).toBeTruthy());
    expect(callsTo('/api/meta/campaigns/campaign-1/edit')).toHaveLength(0);
  });

  it('sends only the changed ad fields to the ad endpoint', async () => {
    renderPage(makeCampaign([makeAd()]));

    const headline = screen
      .getByText(/^Headlines \(/)
      .parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(headline, { target: { value: 'A new headline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save ad content' }));

    await waitFor(() => expect(adPatchCalls()).toHaveLength(1));
    const [, init] = adPatchCalls()[0];
    // No imageIds: the selection was not touched. No linkUrl: the field is gone.
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      headlines: ['A new headline'],
    });
    await waitFor(() =>
      expect(screen.getByText(/Meta will review the ad again/)).toBeTruthy()
    );
  });

  it('skips the ad request when the creative is untouched', async () => {
    renderPage(makeCampaign([makeAd()]));

    fireEvent.click(screen.getByRole('button', { name: 'Save ad content' }));

    await waitFor(() => expect(screen.getByText('No changes to save')).toBeTruthy());
    expect(adPatchCalls()).toHaveLength(0);
  });

  it('surfaces platform warnings returned by the ad endpoint', async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ warnings: ['Google: quota exceeded'] }));
    renderPage(makeCampaign([makeAd()]));

    const headline = screen
      .getByText(/^Headlines \(/)
      .parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(headline, { target: { value: 'Another headline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save ad content' }));

    await waitFor(() =>
      expect(screen.getByText(/Platform push had issues: Google: quota exceeded/)).toBeTruthy()
    );
  });

  it('shows the rejection reason inline for a disapproved ad', () => {
    renderPage(
      makeCampaign([
        makeAd({
          approvalStatus: 'DISAPPROVED',
          rejectionReason: 'Misleading claim in the headline',
          suggestedCorrection: 'Remove superlatives • Avoid absolute claims',
        }),
      ])
    );

    expect(screen.getByText('This ad was rejected')).toBeTruthy();
    expect(screen.getByText(/Misleading claim in the headline/)).toBeTruthy();
    expect(screen.getByText('Remove superlatives')).toBeTruthy();
    expect(screen.getByText('Avoid absolute claims')).toBeTruthy();
  });

  it('pre-selects the ad named by focusAdId and scrolls to the section', () => {
    const campaign = makeCampaign([
      makeAd({ id: 'ad-1', name: 'Images' }),
      makeAd({ id: 'ad-2', name: 'Videos', headlines: ['Video headline'] }),
    ]);
    renderPage(campaign, { focusSection: 'ad', focusAdId: 'ad-2' });

    const selected = screen.getByRole('tab', { selected: true });
    expect(selected.textContent).toBe('Videos');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it('applies the Google headline limit when the ad is synced to Google', () => {
    renderPage(
      makeCampaign([makeAd({ metaAdId: null, googleAdId: 'g-1' })], { platforms: ['GOOGLE'] })
    );

    const headline = screen
      .getByText(/^Headlines \(/)
      .parentElement!.querySelector('input') as HTMLInputElement;
    expect(headline.getAttribute('maxlength')).toBe('40');
    expect(screen.getByText(/Google Ads requires at least one/)).toBeTruthy();
  });

  it('no longer offers a destination URL field', () => {
    renderPage(makeCampaign([makeAd()]));

    expect(screen.queryByLabelText(/destination url/i)).toBeNull();
  });

  it('sends the new image ids when the media selection changes', async () => {
    renderPage(makeCampaign([makeAd()]));

    toggleAsset('img-2');
    fireEvent.click(screen.getByRole('button', { name: 'Save ad content' }));

    await waitFor(() => expect(adPatchCalls()).toHaveLength(1));
    const [, init] = adPatchCalls()[0];
    // Append-only, so the stored asset keeps its position.
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({
      imageIds: ['img-1', 'img-2'],
    });
  });

  it('blocks saving when every asset is deselected', async () => {
    renderPage(makeCampaign([makeAd()]));

    toggleAsset('img-1');

    await waitFor(() => expect(screen.getByText('Select at least one asset.')).toBeTruthy());
    const save = screen.getByRole('button', { name: 'Save ad content' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.click(save);
    expect(adPatchCalls()).toHaveLength(0);
  });

  it('offers only videos for a video ad', () => {
    const ad = makeAd({
      adSetType: 'VIDEO',
      images: [],
      videos: [{ id: 'vid-1', name: 'Trailer', url: 'https://cdn.test/trailer.mp4', thumbnailUrl: 'https://cdn.test/trailer.jpg', metaVideoId: 'meta-video-1' }],
    } as unknown as Partial<CampaignAd>);

    renderPage(makeCampaign([ad]), { images: [], videos: [makeVideo()] });

    expect(screen.getByText('Videos')).toBeTruthy();
    expect(screen.queryByText('Images')).toBeNull();
    expect(document.querySelector('[data-testid="asset-vid-1"]')).toBeTruthy();
  });

  it('blocks selecting a video that is still uploading to Meta', () => {
    const ad = makeAd({
      adSetType: 'VIDEO',
      images: [],
      videos: [{ id: 'vid-1', name: 'Trailer', url: 'https://cdn.test/trailer.mp4', thumbnailUrl: 'https://cdn.test/trailer.jpg', metaVideoId: 'meta-video-1' }],
    } as unknown as Partial<CampaignAd>);

    renderPage(makeCampaign([ad]), {
      images: [],
      videos: [makeVideo(), makeVideo({ id: 'vid-2', name: 'Teaser', metaVideoId: null })],
    });

    const pending = document.querySelector('[data-testid="asset-vid-2"] input[type="checkbox"]');
    expect((pending as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByLabelText('Still uploading to Meta. Available in a few minutes.')).toBeTruthy();
  });

  it('requests a Meta preview once the edits settle', async () => {
    renderPage(makeCampaign([makeAd()]));

    await waitFor(() => expect(previewCalls()).toHaveLength(1), { timeout: 2000 });
    const [, init] = previewCalls()[0];
    expect(JSON.parse((init as RequestInit).body as string)).toMatchObject({
      headline: 'Watch the film',
      primaryText: 'A quiet story about a long summer.',
      mediaUrl: 'https://cdn.test/poster.jpg',
      mediaType: 'IMAGE',
      format: 'MOBILE_FEED_STANDARD',
      // Still sent even though the field left the form.
      linkUrl: 'https://pijama.film/films/film-1',
    });
  });

  it('renders a native preview for a Google ad instead of calling Meta', async () => {
    renderPage(
      makeCampaign([makeAd({ metaAdId: null, googleAdId: 'g-1' })], { platforms: ['GOOGLE'] })
    );

    await waitFor(() => expect(screen.getByText(/Approximate preview/)).toBeTruthy());
    expect(previewCalls()).toHaveLength(0);
  });

  it('does not preview an ad with no media selected', async () => {
    renderPage(makeCampaign([makeAd()]));

    toggleAsset('img-1');

    await waitFor(() =>
      expect(screen.getByText('Select at least one asset to see how the ad will look.')).toBeTruthy()
    );
    expect(previewCalls()).toHaveLength(0);
  });
});
