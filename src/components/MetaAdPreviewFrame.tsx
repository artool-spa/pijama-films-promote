'use client';

import { Alert, Box } from '@mui/material';

/**
 * Meta returns an ad preview as an HTML-escaped `<iframe src="...">` snippet.
 *
 * Pull the frame URL out of it and render our own iframe rather than injecting
 * the markup into the page: unaudited third-party HTML in our own origin has no
 * security boundary at all, and a `srcDoc` document inherits the embedder's
 * origin, so `srcDoc` + `allow-same-origin` is not a boundary either. A frame
 * with a cross-origin `src` is.
 */
export function metaPreviewSrc(html: string): string | null {
  const match = /<iframe[^>]*\ssrc=["']([^"']+)["']/i.exec(html);
  if (!match) return null;

  const decoded = match[1]
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");

  try {
    const url = new URL(decoded);
    if (url.protocol !== 'https:') return null;
    if (!/(^|\.)facebook\.com$/.test(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export type MetaAdPreviewFrameProps = {
  /** The raw `preview` string returned by the Meta preview endpoints. */
  html: string;
  title: string;
  height?: number;
};

export default function MetaAdPreviewFrame({
  html,
  title,
  height = 660,
}: MetaAdPreviewFrameProps) {
  const src = metaPreviewSrc(html);

  if (!src) {
    return <Alert severity="warning">Could not display the preview returned by Meta.</Alert>;
  }

  return (
    <Box
      component="iframe"
      src={src}
      title={title}
      referrerPolicy="no-referrer"
      // Cross-origin frame, so Facebook's own scripts keep their origin.
      sandbox="allow-scripts"
      sx={{ width: '100%', height, border: 'none' }}
    />
  );
}
