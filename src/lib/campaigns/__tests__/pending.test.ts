import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { CampaignWithPartnerAndAds } from '@/models/campaign';

const syncCampaignToMeta = vi.fn();
const syncCampaignToGoogle = vi.fn();
const areGoogleImageAssetsReady = vi.fn();

vi.mock('../sync', () => ({
  syncCampaignToMeta: (...args: unknown[]) => syncCampaignToMeta(...args),
  syncCampaignToGoogle: (...args: unknown[]) => syncCampaignToGoogle(...args),
  areGoogleImageAssetsReady: (...args: unknown[]) => areGoogleImageAssetsReady(...args),
}));

const { syncPendingCampaign } = await import('../pending');

/** Only the fields syncPendingCampaign reads. */
function campaign(
  overrides: Partial<CampaignWithPartnerAndAds> = {}
): CampaignWithPartnerAndAds {
  return {
    id: 'camp_1',
    platforms: ['META', 'GOOGLE'],
    metaCampaignId: null,
    googleCampaignId: null,
    partner: { name: 'Indie Films' },
    ads: [],
    ...overrides,
  } as unknown as CampaignWithPartnerAndAds;
}

describe('syncPendingCampaign', () => {
  beforeEach(() => {
    syncCampaignToMeta.mockReset().mockResolvedValue({ synced: true });
    syncCampaignToGoogle.mockReset().mockResolvedValue({ synced: true });
    areGoogleImageAssetsReady.mockReset().mockReturnValue(true);
  });

  it('syncs both platforms when the assets are ready', async () => {
    const result = await syncPendingCampaign(campaign());

    expect(result).toEqual({ synced: true, stillPending: false, errors: [] });
    expect(syncCampaignToMeta).toHaveBeenCalledOnce();
    expect(syncCampaignToGoogle).toHaveBeenCalledOnce();
  });

  it('holds the campaign back while Google has no images', async () => {
    areGoogleImageAssetsReady.mockReturnValue(false);

    const result = await syncPendingCampaign(campaign());

    expect(result).toEqual({ synced: false, stillPending: true, errors: [] });
    expect(syncCampaignToMeta).not.toHaveBeenCalled();
    expect(syncCampaignToGoogle).not.toHaveBeenCalled();
  });

  // Meta uploads its own videos, so a Meta-only campaign is never gated on the
  // image check that only Google needs.
  it('does not gate a Meta-only campaign on the Google image check', async () => {
    areGoogleImageAssetsReady.mockReturnValue(false);

    const result = await syncPendingCampaign(campaign({ platforms: ['META'] }));

    expect(result.stillPending).toBe(false);
    expect(syncCampaignToMeta).toHaveBeenCalledOnce();
    expect(syncCampaignToGoogle).not.toHaveBeenCalled();
  });

  it('skips a platform that is already synced', async () => {
    await syncPendingCampaign(campaign({ metaCampaignId: 'meta_123' }));

    expect(syncCampaignToMeta).not.toHaveBeenCalled();
    expect(syncCampaignToGoogle).toHaveBeenCalledOnce();
  });

  it('collects a reported sync error without throwing', async () => {
    syncCampaignToGoogle.mockResolvedValue({ synced: false, syncError: 'quota' });

    const result = await syncPendingCampaign(campaign());

    expect(result.synced).toBe(true); // Meta still went through
    expect(result.errors).toEqual([{ campaignId: 'camp_1', error: 'Google: quota' }]);
  });

  // One platform throwing must not abort the other, or a Meta outage would
  // strand every campaign that also targets Google.
  it('keeps going when a platform throws', async () => {
    syncCampaignToMeta.mockRejectedValue(new Error('Meta is down'));

    const result = await syncPendingCampaign(campaign());

    expect(syncCampaignToGoogle).toHaveBeenCalledOnce();
    expect(result.errors).toEqual([
      { campaignId: 'camp_1', error: 'Meta: Meta is down' },
    ]);
  });
});
