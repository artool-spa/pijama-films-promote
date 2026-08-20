import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import CampaignEditClient from '../client';
import type { Film } from '@/models/film';
import type { CampaignWithPartnerAndAds } from '@/models/campaign';

const push = vi.fn();
const refresh = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, refresh }),
}));

type CampaignAd = CampaignWithPartnerAndAds['ads'][number];

const film = { id: 'film-1', title: 'The Long Summer' } as unknown as Film;

function makeAd(overrides: Partial<CampaignAd> = {}): CampaignAd {
  return {
    id: 'ad-1',
    metaAdId: 'meta-123',
    googleAdId: null,
    name: 'The Long Summer - ES',
    headlines: ['Watch the film'],
    bodies: ['A quiet story about a long summer.'],
    descriptions: ['Rent it tonight'],
    linkUrl: 'https://pijama.film/films/film-1',
    approvalStatus: 'APPROVED',
    rejectionReason: null,
    suggestedCorrection: null,
    updatedAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  } as unknown as CampaignAd;
}

function makeCampaign(ads: CampaignAd[]): CampaignWithPartnerAndAds {
  return {
    id: 'campaign-1',
    name: 'Summer launch',
    budget: 25,
    budgetType: 'DAILY',
    endDate: null,
    ads,
    partner: { id: 'p1', name: 'Pijama Films' },
  } as unknown as CampaignWithPartnerAndAds;
}

function renderPage(
  campaign: CampaignWithPartnerAndAds,
  props: { focusSection?: 'ad' | null; focusAdId?: string | null } = {}
) {
  render(
    <CampaignEditClient
      film={film}
      campaign={campaign}
      focusSection={props.focusSection ?? null}
      focusAdId={props.focusAdId ?? null}
    />
  );
}

function jsonResponse(body: unknown) {
  return { ok: true, json: async () => body } as Response;
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
    global.fetch = vi.fn().mockResolvedValue(jsonResponse({ warnings: [] }));
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

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/meta/campaigns/campaign-1/edit');
    expect(JSON.parse((init as RequestInit).body as string)).toEqual({ budget: 40 });
    expect(refresh).toHaveBeenCalled();
  });

  it('does not call the API when nothing changed', async () => {
    renderPage(makeCampaign([makeAd()]));

    submitFormOf('Save campaign settings');

    await waitFor(() => expect(screen.getByText('No changes to save')).toBeTruthy());
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('sends only the changed ad fields to the ad endpoint', async () => {
    renderPage(makeCampaign([makeAd()]));

    const headline = screen
      .getByText(/^Headlines \(/)
      .parentElement!.querySelector('input') as HTMLInputElement;
    fireEvent.change(headline, { target: { value: 'A new headline' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save ad content' }));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(1));
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe('/api/meta/ads/ad-1');
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
    expect(global.fetch).not.toHaveBeenCalled();
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
    renderPage(makeCampaign([makeAd({ metaAdId: null, googleAdId: 'g-1' })]));

    const headline = screen
      .getByText(/^Headlines \(/)
      .parentElement!.querySelector('input') as HTMLInputElement;
    expect(headline.getAttribute('maxlength')).toBe('40');
    expect(screen.getByText(/Google Ads requires at least one/)).toBeTruthy();
  });
});
