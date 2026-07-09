/**
 * UTM tagging for ad destination links.
 *
 * Ad `linkUrl`s are stored raw. We append UTM tracking parameters at sync time,
 * where the destination platform (Meta / Google) is known, so `utm_source`
 * reflects the real traffic source.
 */

export type UtmParams = {
  source: string; // e.g. 'meta' | 'google'
  medium?: string; // e.g. 'cpc'
  campaign?: string; // campaign name
  content?: string; // e.g. language code
  term?: string;
};

/**
 * Normalize a value into a UTM-friendly token: lowercase, spaces/punctuation
 * collapsed to underscores. Keeps analytics values clean and stable.
 */
function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Append UTM parameters to a URL.
 *
 * - Preserves any existing query string and fragment.
 * - If the URL already carries a `utm_source`, it is returned unchanged
 *   (assume it was tagged intentionally).
 * - Returns the original string unchanged if it cannot be parsed as a URL.
 */
export function appendUtmParams(url: string, params: UtmParams): string {
  if (!url) return url;

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a parseable absolute URL — leave it untouched.
    return url;
  }

  // Don't clobber links that are already UTM-tagged.
  if (parsed.searchParams.has('utm_source')) {
    return url;
  }

  const mapping: Array<[string, string | undefined]> = [
    ['utm_source', params.source],
    ['utm_medium', params.medium],
    ['utm_campaign', params.campaign],
    ['utm_content', params.content],
    ['utm_term', params.term],
  ];

  for (const [key, value] of mapping) {
    if (value) {
      parsed.searchParams.set(key, slugify(value));
    }
  }

  return parsed.toString();
}
