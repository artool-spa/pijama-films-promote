import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import YAML from 'yaml';

/**
 * `apphosting.yaml` is deployment configuration, and until this file existed
 * NOTHING in the repo looked at it. `tsc`, lint and the whole suite are blind to
 * it: it is read by App Hosting at build time, in a place no local test reaches.
 *
 * That gap cost a failed production deploy. build-2026-09-01-001 died with
 *
 *     Your apphosting.yaml file at path '/workspace/apphosting.yaml' is not
 *     formatted properly.
 *
 * The message names the FILE, not the line. The single offending entry out of 34
 * was `ATLAS_LOGIN_ALLOWED_PARTNER_IDS` with `value: ""` - App Hosting rejects an
 * empty value. Everything else about the change was green.
 *
 * So these assertions are not style checks. Each one stands for a way the file
 * can be wrong that only the deploy would have told us, and one of them is the
 * exact failure above.
 */

type EnvEntry = {
  variable?: unknown;
  value?: unknown;
  secret?: unknown;
  availability?: unknown;
};

const CONFIG_PATH = join(process.cwd(), 'apphosting.yaml');
const VALID_AVAILABILITY = ['BUILD', 'RUNTIME'];

function loadConfig(): { runConfig?: unknown; env?: unknown } {
  return YAML.parse(readFileSync(CONFIG_PATH, 'utf8')) as {
    runConfig?: unknown;
    env?: unknown;
  };
}

function envEntries(): EnvEntry[] {
  const { env } = loadConfig();

  // Cast is guarded by the shape tests below; they run in the same file, so a
  // malformed env surfaces as their failure and not as a crash here.
  return Array.isArray(env) ? (env as EnvEntry[]) : [];
}

/** `variable` for messages, or a positional label when even that is missing. */
function label(entry: EnvEntry, index: number): string {
  return typeof entry.variable === 'string' && entry.variable.length > 0
    ? entry.variable
    : `env[${index}] (no variable name)`;
}

describe('apphosting.yaml is shaped the way App Hosting requires', () => {
  it('parses as YAML', () => {
    expect(() => loadConfig()).not.toThrow();
  });

  it('has runConfig and a non-empty env list', () => {
    const config = loadConfig();

    expect(config.runConfig, 'runConfig sets instances, cpu and memory').toBeTruthy();
    expect(Array.isArray(config.env), 'env must be a list of variable entries').toBe(true);
    expect(envEntries().length).toBeGreaterThan(0);
  });

  it('gives every entry a variable name', () => {
    const nameless = envEntries()
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => typeof entry.variable !== 'string' || entry.variable.length === 0);

    expect(
      nameless.map(({ index }) => `env[${index}]`),
      'an entry without `variable` configures nothing and fails the build'
    ).toEqual([]);
  });

  it('gives every entry exactly one of value or secret', () => {
    const wrong = envEntries()
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => ('value' in entry) === ('secret' in entry));

    expect(
      wrong.map(({ entry, index }) => label(entry, index)),
      'each entry is either plain config (`value`) or a Secret Manager reference ' +
        '(`secret`). Neither means the variable is absent at runtime; both at once is ' +
        'ambiguous and rejected'
    ).toEqual([]);
  });

  /**
   * THE regression guard. This is the one that failed the deploy.
   *
   * "Nobody / nothing / disabled" is expressed by LEAVING THE ENTRY OUT, not by
   * an empty value - see the comment where ATLAS_LOGIN_ALLOWED_PARTNER_IDS used
   * to be. Code that needs that distinction must read absent and empty the same
   * way, as `getAtlasAllowedPartnerIds()` does.
   */
  it('never carries an empty or whitespace-only value', () => {
    const empty = envEntries()
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        if (!('value' in entry)) return false;
        if (entry.value === null || entry.value === undefined) return true;

        return typeof entry.value === 'string' && entry.value.trim().length === 0;
      });

    expect(
      empty.map(({ entry, index }) => label(entry, index)),
      'App Hosting rejects an empty value and the WHOLE build fails with ' +
        '"apphosting.yaml is not formatted properly" - a message that names the file and ' +
        'not the line, which is why build-2026-09-01-001 took a diagnosis to explain. ' +
        'To express "nobody" or "nothing", omit the entry entirely'
    ).toEqual([]);
  });

  it('never carries a value with surrounding whitespace', () => {
    // A quoted scalar keeps its padding, and the runtime receives it verbatim.
    // The symptom is silent: a URL or an id that looks right and matches nothing.
    const padded = envEntries()
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) => typeof entry.value === 'string' && entry.value !== entry.value.trim()
      );

    expect(
      padded.map(({ entry, index }) => label(entry, index)),
      'leading or trailing whitespace survives into the runtime value and breaks ' +
        'comparisons without ever looking wrong in the file'
    ).toEqual([]);
  });

  it('names a real secret for every secret entry', () => {
    const bad = envEntries()
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          'secret' in entry &&
          (typeof entry.secret !== 'string' || entry.secret.trim().length === 0)
      );

    expect(
      bad.map(({ entry, index }) => label(entry, index)),
      '`secret` is a Secret Manager name, so it cannot be empty'
    ).toEqual([]);
  });

  it('declares a valid availability on every entry', () => {
    const bad = envEntries()
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => {
        const availability = entry.availability;

        if (!Array.isArray(availability) || availability.length === 0) return true;

        return availability.some((scope) => !VALID_AVAILABILITY.includes(scope as string));
      });

    expect(
      bad.map(({ entry, index }) => label(entry, index)),
      `availability must be a non-empty list drawn from ${VALID_AVAILABILITY.join(' / ')}; ` +
        'an entry without it is not injected anywhere'
    ).toEqual([]);
  });

  it('declares each variable only once', () => {
    const seen = new Set<string>();
    const duplicated = new Set<string>();

    for (const entry of envEntries()) {
      if (typeof entry.variable !== 'string') continue;
      if (seen.has(entry.variable)) duplicated.add(entry.variable);
      seen.add(entry.variable);
    }

    expect(
      [...duplicated],
      'a repeated variable silently shadows the earlier entry, so the file says one ' +
        'thing and the runtime does another'
    ).toEqual([]);
  });

  /**
   * Project-specific, and it comes from a gotcha this stack has already produced:
   * a NEXT_PUBLIC_* value is baked into the client bundle AT BUILD TIME. Declared
   * RUNTIME-only it is simply missing in the browser, and the symptom is a page
   * that renders fine while reporting the value as unconfigured - which is what
   * "none configured" in the /auth panel would have meant for
   * NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS.
   */
  it('gives every NEXT_PUBLIC_ variable BUILD availability', () => {
    const missingBuild = envEntries()
      .map((entry, index) => ({ entry, index }))
      .filter(
        ({ entry }) =>
          typeof entry.variable === 'string' &&
          entry.variable.startsWith('NEXT_PUBLIC_') &&
          !(Array.isArray(entry.availability) && entry.availability.includes('BUILD'))
      );

    expect(
      missingBuild.map(({ entry, index }) => label(entry, index)),
      'NEXT_PUBLIC_* is read by the browser, so it has to exist when the client bundle ' +
        'is built. RUNTIME alone leaves it undefined in the browser and the page reports ' +
        'the value as unconfigured instead of failing'
    ).toEqual([]);
  });
});
