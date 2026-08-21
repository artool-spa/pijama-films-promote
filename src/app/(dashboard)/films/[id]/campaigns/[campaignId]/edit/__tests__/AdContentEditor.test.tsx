import { describe, it, expect } from 'vitest';
import { metaPreviewSrc } from '../AdContentEditor';

/**
 * The preview HTML comes from Meta. We never inject it into the page, we pull
 * the frame URL out of it — so this parser is the security boundary.
 */
describe('metaPreviewSrc', () => {
  it('extracts the frame URL and decodes its entities', () => {
    const html =
      '<iframe src="https://www.facebook.com/ads/api/preview_iframe.php?d=1&amp;t=abc" width="340"></iframe>';

    expect(metaPreviewSrc(html)).toBe(
      'https://www.facebook.com/ads/api/preview_iframe.php?d=1&t=abc'
    );
  });

  it('accepts facebook subdomains', () => {
    const html = "<iframe src='https://web.facebook.com/preview'></iframe>";

    expect(metaPreviewSrc(html)).toBe('https://web.facebook.com/preview');
  });

  it('rejects any other host', () => {
    expect(metaPreviewSrc('<iframe src="https://evil.example.com/x"></iframe>')).toBeNull();
    // Suffix lookalikes must not pass either.
    expect(metaPreviewSrc('<iframe src="https://notfacebook.com/x"></iframe>')).toBeNull();
    expect(metaPreviewSrc('<iframe src="https://facebook.com.evil.io/x"></iframe>')).toBeNull();
  });

  it('rejects non-https schemes', () => {
    expect(metaPreviewSrc('<iframe src="http://www.facebook.com/x"></iframe>')).toBeNull();
    expect(metaPreviewSrc('<iframe src="javascript:alert(1)"></iframe>')).toBeNull();
  });

  it('returns null when there is no iframe or the URL is malformed', () => {
    expect(metaPreviewSrc('<div>no preview</div>')).toBeNull();
    expect(metaPreviewSrc('<iframe src="not a url"></iframe>')).toBeNull();
    expect(metaPreviewSrc('')).toBeNull();
  });
});
