/**
 * `/api/partners` was deleted: any authenticated session could list every
 * producer, create one, and edit or delete another producer's record. No screen
 * called it. This test keeps it from coming back by accident.
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';

const PARTNERS_API = path.resolve(__dirname, '../app/api/partners');

describe('/api/partners', () => {
  it('has no route module', () => {
    expect(existsSync(path.join(PARTNERS_API, 'route.ts'))).toBe(false);
  });

  it('has no [id] route module', () => {
    expect(existsSync(path.join(PARTNERS_API, '[id]', 'route.ts'))).toBe(false);
  });

  it('has no directory at all', () => {
    expect(existsSync(PARTNERS_API)).toBe(false);
  });
});
