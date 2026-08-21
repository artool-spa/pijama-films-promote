/**
 * Asset limits shared by the ad editor and the model layer.
 *
 * Like `@/lib/assets/status`, this module stays free of server-only imports so
 * client components can read it without pulling `firebase-admin` into the
 * bundle.
 */

/** Meta dynamic creative and `AdUpdateSchema` both cap an ad at 10 assets. */
export const MAX_AD_ASSETS = 10;
