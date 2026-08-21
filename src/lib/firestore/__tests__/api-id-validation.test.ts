import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { IdSchema } from '@/lib/firestore';

/**
 * A real Firestore auto-id: 20 characters from a mixed alphabet. Zod's `.cuid()`
 * requires a leading "c", so an auto-id passed it only by luck — this exact id
 * is the one that blocked publishing in issue #33.
 */
const FIRESTORE_AUTO_ID = '6Fcqy5f3zGfShXGQcxgS';
/** Ids migrated from Postgres kept their cuid and must keep working. */
const LEGACY_CUID = 'cmrwpxrfo0005s60100o98seo';

function tsFilesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return tsFilesUnder(full);
    return full.endsWith('.ts') || full.endsWith('.tsx') ? [full] : [];
  });
}

describe('document id validation', () => {
  it('accepts a Firestore auto-id', () => {
    expect(IdSchema.safeParse(FIRESTORE_AUTO_ID).success).toBe(true);
  });

  it('still accepts an id migrated from Postgres', () => {
    expect(IdSchema.safeParse(LEGACY_CUID).success).toBe(true);
  });

  it('rejects an empty id', () => {
    expect(IdSchema.safeParse('').success).toBe(false);
  });

  it('leaves no cuid validation anywhere in the API layer', () => {
    // Firestore generates the ids now, so a `.cuid()` anywhere in a request
    // schema rejects roughly 97% of the ids this app creates. Everything must
    // go through IdSchema instead.
    const offenders = tsFilesUnder(join(process.cwd(), 'src'))
      // Tests are allowed to name it — this file does, right above.
      .filter((file) => !file.includes('__tests__'))
      .filter((file) => readFileSync(file, 'utf8').includes('.cuid()'))
      .map((file) => file.replace(process.cwd() + '/', ''));

    expect(offenders).toEqual([]);
  });
});
