import { describe, it, expect } from 'vitest';
import { appendUtmParams } from '../utm';

describe('appendUtmParams', () => {
  it('appends all provided UTM params', () => {
    const result = appendUtmParams('https://pijama.film/films/abc', {
      source: 'meta',
      medium: 'cpc',
      campaign: 'My Film',
      content: 'es',
    });
    const url = new URL(result);
    expect(url.searchParams.get('utm_source')).toBe('meta');
    expect(url.searchParams.get('utm_medium')).toBe('cpc');
    expect(url.searchParams.get('utm_campaign')).toBe('my_film'); // slugified
    expect(url.searchParams.get('utm_content')).toBe('es');
  });

  it('slugifies values (lowercase, punctuation to underscores)', () => {
    const result = appendUtmParams('https://example.com/', {
      source: 'Google',
      campaign: 'Summer Sale 2026!',
    });
    const url = new URL(result);
    expect(url.searchParams.get('utm_source')).toBe('google');
    expect(url.searchParams.get('utm_campaign')).toBe('summer_sale_2026');
  });

  it('preserves an existing query string', () => {
    const result = appendUtmParams('https://example.com/watch?ref=home', {
      source: 'meta',
    });
    const url = new URL(result);
    expect(url.searchParams.get('ref')).toBe('home');
    expect(url.searchParams.get('utm_source')).toBe('meta');
  });

  it('leaves already-tagged URLs unchanged', () => {
    const tagged = 'https://example.com/?utm_source=newsletter';
    expect(appendUtmParams(tagged, { source: 'meta' })).toBe(tagged);
  });

  it('only sets params that are provided', () => {
    const result = appendUtmParams('https://example.com/', { source: 'meta' });
    const url = new URL(result);
    expect(url.searchParams.get('utm_source')).toBe('meta');
    expect(url.searchParams.has('utm_medium')).toBe(false);
    expect(url.searchParams.has('utm_campaign')).toBe(false);
  });

  it('returns non-URL / empty input untouched', () => {
    expect(appendUtmParams('', { source: 'meta' })).toBe('');
    expect(appendUtmParams('not-a-url', { source: 'meta' })).toBe('not-a-url');
  });
});
