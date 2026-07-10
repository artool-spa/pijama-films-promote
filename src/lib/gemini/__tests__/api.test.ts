import { describe, it, expect } from 'vitest';
import {
  pickVariantAngles,
  generateCopiesForLanguage,
  generateCopiesForFilm,
} from '../api';
import type { GeminiClient } from '../client';
import type { FilmDataForPrompt } from '../types';

const film: FilmDataForPrompt = {
  id: 'film-1',
  title: 'The Long Night',
  description: 'A quiet drama about memory.',
  genre: ['Drama'],
  director: 'Ana Ruiz',
  year: 2024,
  duration: 104,
};

/**
 * Build a stub GeminiClient whose generateContent echoes back valid JSON with
 * one copy per requested variant. It captures the prompt(s) it received.
 */
function makeStubClient() {
  const prompts: string[] = [];
  const client = {
    async generateContent(prompt: string): Promise<string> {
      prompts.push(prompt);
      // Derive the requested labels from the prompt's variant list.
      const labels = ['A', 'B', 'C', 'D', 'E', 'F'].filter((l) =>
        prompt.includes(`"variant": "${l}"`)
      );
      const copies = labels.map((variant) => ({
        headline: `Headline ${variant}`,
        primaryText: `Watch on Pijama Films ${variant}`,
        variant,
      }));
      return JSON.stringify({ copies });
    },
  } as unknown as GeminiClient;
  return { client, prompts };
}

describe('pickVariantAngles', () => {
  it('returns the requested number of distinct angles', () => {
    const angles = pickVariantAngles(3);
    expect(angles).toHaveLength(3);
    const keys = new Set(angles.map((a) => a.key));
    expect(keys.size).toBe(3);
  });

  it('never returns more angles than the pool holds', () => {
    const angles = pickVariantAngles(999);
    const keys = new Set(angles.map((a) => a.key));
    // All returned angles are distinct and count equals the pool size.
    expect(keys.size).toBe(angles.length);
    expect(angles.length).toBeGreaterThanOrEqual(3);
  });

  it('tends to vary the selected set across calls', () => {
    const signatures = new Set<string>();
    for (let i = 0; i < 20; i++) {
      signatures.add(pickVariantAngles(3).map((a) => a.key).join(','));
    }
    // With a 12-angle pool and random sampling, 20 draws should not all match.
    expect(signatures.size).toBeGreaterThan(1);
  });
});

describe('generateCopiesForLanguage', () => {
  it('defaults to 3 variants labelled A/B/C', async () => {
    const { client } = makeStubClient();
    const copies = await generateCopiesForLanguage(client, film, 'en');
    expect(copies).toHaveLength(3);
    expect(copies.map((c) => c.variant)).toEqual(['A', 'B', 'C']);
  });

  it('honors a custom variantCount', async () => {
    const { client } = makeStubClient();
    const copies = await generateCopiesForLanguage(client, film, 'en', {
      variantCount: 5,
    });
    expect(copies).toHaveLength(5);
    expect(copies.map((c) => c.variant)).toEqual(['A', 'B', 'C', 'D', 'E']);
  });

  it('clamps an out-of-range variantCount to the supported max', async () => {
    const { client } = makeStubClient();
    const copies = await generateCopiesForLanguage(client, film, 'en', {
      variantCount: 50,
    });
    expect(copies).toHaveLength(6);
  });

  it('does not require description or callToAction fields', async () => {
    const { client } = makeStubClient();
    const copies = await generateCopiesForLanguage(client, film, 'en');
    for (const copy of copies) {
      expect(copy.headline).toBeTruthy();
      expect(copy.primaryText).toBeTruthy();
      expect(copy.description).toBeUndefined();
      expect(copy.callToAction).toBeUndefined();
    }
  });

  it('no longer asks the model for description or callToAction', async () => {
    const { client, prompts } = makeStubClient();
    await generateCopiesForLanguage(client, film, 'en');
    expect(prompts[0]).not.toContain('callToAction');
    expect(prompts[0]).not.toMatch(/"description"/);
  });
});

describe('generateCopiesForFilm', () => {
  it('generates copies for each requested language', async () => {
    const { client } = makeStubClient();
    const result = await generateCopiesForFilm(client, film, ['en', 'es']);
    expect(Object.keys(result)).toEqual(['en', 'es']);
    expect(result.en).toHaveLength(3);
    expect(result.es).toHaveLength(3);
  });
});
