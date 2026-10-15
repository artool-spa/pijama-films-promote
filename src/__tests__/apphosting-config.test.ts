import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
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
 *
 * They run over EVERY `apphosting*.yaml` in the repo, not just the base file.
 * App Hosting merges a base file with an environment-specific one
 * (`apphosting.<environment>.yaml`, the environment named per backend), so an
 * override file reaches a real build and can fail it in exactly the same ways.
 */

type EnvEntry = {
  variable?: unknown;
  value?: unknown;
  secret?: unknown;
  availability?: unknown;
};

const BASE_CONFIG = 'apphosting.yaml';
const VALID_AVAILABILITY = ['BUILD', 'RUNTIME'];

/**
 * Variables that may exist in an override file WITHOUT being in the base file.
 *
 * This is the exception to "only names variables the base declares", and each
 * entry has to earn it: the base cannot declare it because it would break
 * production. The only case so far is a `secret:` that exists in the
 * development project's Secret Manager and not in production's - App Hosting
 * resolves every secret at build time, so a base-file reference to a missing
 * secret fails the PRODUCTION build. The code reads these at call time and
 * fails closed when they are absent.
 */
const DEV_ONLY_VARIABLES = ['ATLAS_SERVER_API_KEY', 'ATLAS_SERVER_API_BASE_URL'];

/** Every App Hosting config in the repo: the base, plus any per-environment file. */
function configFiles(): string[] {
  return readdirSync(process.cwd())
    .filter((name) => /^apphosting\.(.+\.)?yaml$/.test(name))
    .sort();
}

function loadConfig(file: string): { runConfig?: unknown; env?: unknown } {
  return YAML.parse(readFileSync(join(process.cwd(), file), 'utf8')) as {
    runConfig?: unknown;
    env?: unknown;
  };
}

function envEntries(file: string): EnvEntry[] {
  const { env } = loadConfig(file);

  // Cast is guarded by the shape tests below; they run in the same file, so a
  // malformed env surfaces as their failure and not as a crash here.
  return Array.isArray(env) ? (env as EnvEntry[]) : [];
}

/** The `value` of a variable in one file, or undefined if absent or a secret. */
function valueOf(file: string, variable: string): string | undefined {
  const entry = envEntries(file).find((candidate) => candidate.variable === variable);

  return typeof entry?.value === 'string' ? entry.value : undefined;
}

/**
 * Literals that identify production, read from the base file so this survives
 * production itself ever moving. The project number is recovered from the
 * invoker service account, which embeds it — that is what makes
 * CRON_INVOKER_SERVICE_ACCOUNTS count as naming production.
 */
function productionLiterals(): string[] {
  const literals = [
    valueOf(BASE_CONFIG, 'FIREBASE_PROJECT_ID'),
    valueOf(BASE_CONFIG, 'GCS_BUCKET_NAME'),
    valueOf(BASE_CONFIG, 'CRON_INVOKER_SERVICE_ACCOUNTS')?.match(/^(\d{6,})-compute@/)?.[1],
    'pk_live_',
  ];

  return literals.filter(
    (literal): literal is string => typeof literal === 'string' && literal.length > 0
  );
}

/** `variable` for messages, or a positional label when even that is missing. */
function label(entry: EnvEntry, index: number): string {
  return typeof entry.variable === 'string' && entry.variable.length > 0
    ? entry.variable
    : `env[${index}] (no variable name)`;
}

describe.each(configFiles())('%s is shaped the way App Hosting requires', (file) => {
  it('parses as YAML', () => {
    expect(() => loadConfig(file)).not.toThrow();
  });

  it('has a non-empty env list', () => {
    const config = loadConfig(file);

    expect(Array.isArray(config.env), 'env must be a list of variable entries').toBe(true);
    expect(envEntries(file).length).toBeGreaterThan(0);
  });

  it('gives every entry a variable name', () => {
    const nameless = envEntries(file)
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry }) => typeof entry.variable !== 'string' || entry.variable.length === 0);

    expect(
      nameless.map(({ index }) => `env[${index}]`),
      'an entry without `variable` configures nothing and fails the build'
    ).toEqual([]);
  });

  it('gives every entry exactly one of value or secret', () => {
    const wrong = envEntries(file)
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
   *
   * One caveat for override files: the merge is override-only, so an entry
   * cannot be UNSET from one. Omitting it there leaves the base value standing.
   */
  it('never carries an empty or whitespace-only value', () => {
    const empty = envEntries(file)
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
    const padded = envEntries(file)
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
    const bad = envEntries(file)
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
    const bad = envEntries(file)
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

    for (const entry of envEntries(file)) {
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
    const missingBuild = envEntries(file)
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

describe('the base config carries what only it can', () => {
  it('declares runConfig', () => {
    // An override file may restate runConfig, but the base must define it:
    // instances, cpu and memory have no platform default worth inheriting.
    expect(loadConfig(BASE_CONFIG).runConfig, 'runConfig sets instances, cpu and memory').toBeTruthy();
  });
});

/**
 * Cross-file invariants. These only have teeth once a second file exists, and
 * they guard the two ways an environment override goes wrong silently.
 */
describe.each(configFiles().filter((file) => file !== BASE_CONFIG))(
  '%s overrides the base without drifting from it',
  (file) => {
    /**
     * The merge is by variable name. A variable that exists ONLY in the override
     * is therefore not overriding anything - it is a new variable, usually a
     * typo of the one that was meant, and the one that was meant keeps its
     * production value. Nothing reports this.
     */
    it('only names variables the base file also declares', () => {
      const baseNames = new Set(
        envEntries(BASE_CONFIG)
          .map((entry) => entry.variable)
          .filter((name): name is string => typeof name === 'string')
      );

      const unknown = envEntries(file)
        .map((entry) => entry.variable)
        .filter((name): name is string => typeof name === 'string')
        .filter((name) => !baseNames.has(name))
        .filter((name) => !DEV_ONLY_VARIABLES.includes(name));

      expect(
        unknown,
        'a variable present only here overrides nothing — it adds a new one, and the ' +
          'variable it was meant to override silently keeps the base value'
      ).toEqual([]);
    });

    /**
     * The failure this guards is the expensive one: an override file that still
     * carries a production identifier points a non-production backend at the
     * production database, the production bucket, or live payments.
     *
     * The forbidden literals are read from the base file rather than hardcoded,
     * so this stays correct if production itself ever moves.
     */
    it('keeps the dev-only variables out of the base file', () => {
      // The reason they are exempt above. If one reaches the base, the production
      // build resolves a secret that production does not have, and fails.
      const baseNames = envEntries(BASE_CONFIG).map((entry) => entry.variable);

      expect(baseNames.filter((name) => DEV_ONLY_VARIABLES.includes(name as string))).toEqual([]);
    });

    it('carries no production identifier', () => {
      const offending: string[] = [];

      for (const entry of envEntries(file)) {
        if (typeof entry.value !== 'string') continue;

        for (const literal of productionLiterals()) {
          if (entry.value.includes(literal)) {
            offending.push(`${String(entry.variable)} contains "${literal}"`);
          }
        }
      }

      expect(
        offending,
        'this file configures a non-production backend; a production project id, ' +
          'bucket, project number or live key here points it at real data or real money'
      ).toEqual([]);
    });

    /**
     * The mirror image, and the one that actually bit.
     *
     * The assertion above only inspects what the override DECLARES. The real
     * failure was what it OMITTED: the Stripe publishable key was missing from
     * the override, so the merge left the base `pk_live_` value standing and the
     * development backend came up holding a production key. Nothing in the file
     * looked wrong, because the problem was an absence.
     *
     * So: if a base value names production, the override has to replace it.
     * Anything else means that production value reaches a non-production
     * backend, and the merge being override-only guarantees it silently.
     */
    it('overrides every base variable whose value names production', () => {
      const declared = new Set(
        envEntries(file)
          .map((entry) => entry.variable)
          .filter((name): name is string => typeof name === 'string')
      );

      const missing = envEntries(BASE_CONFIG)
        .filter(
          (entry) =>
            typeof entry.value === 'string' &&
            productionLiterals().some((literal) => (entry.value as string).includes(literal))
        )
        .map((entry) => String(entry.variable))
        .filter((name) => !declared.has(name));

      expect(
        missing,
        'these base values name production and this file does not replace them. The ' +
          'merge is override-only, so leaving one out does not neutralise it — the ' +
          'production value reaches this backend intact and nothing reports it'
      ).toEqual([]);
    });
  }
);

/**
 * The audience pairing, across two files the build never compares.
 *
 * Every internal route authorizes its caller by verifying a Google-signed OIDC
 * token minted for INTERNAL_TRIGGER_AUDIENCE. The functions mint it for
 * BACKEND_URL, which lives in `functions/.env.<projectId>` — a different file,
 * in a different deployable, released by a different command.
 *
 * When they disagree every schedule and every queued task gets a 401, the
 * function logs only the status, and the backend logs a rejected caller without
 * saying which audience it wanted. Nothing else in the repo compares them.
 */
describe.each(configFiles())('%s agrees with the functions it is called by', (file) => {
  it('matches INTERNAL_TRIGGER_AUDIENCE to that project BACKEND_URL', () => {
    const audience = valueOf(file, 'INTERNAL_TRIGGER_AUDIENCE');

    // An override file need not restate it; the base value then applies.
    if (audience === undefined) return;

    const projectId = valueOf(file, 'FIREBASE_PROJECT_ID') ?? valueOf(BASE_CONFIG, 'FIREBASE_PROJECT_ID');
    expect(projectId, 'cannot tell which project this config is for').toBeTruthy();

    const envPath = join(process.cwd(), 'functions', `.env.${projectId}`);
    expect(
      existsSync(envPath),
      `functions/.env.${projectId} is missing, so the functions deployed to ${projectId} ` +
        'have no BACKEND_URL and every trigger throws before it calls anything'
    ).toBe(true);

    const backendUrl = readFileSync(envPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.startsWith('BACKEND_URL='))
      ?.slice('BACKEND_URL='.length)
      .trim()
      .replace(/^["']|["']$/g, '');

    expect(
      backendUrl,
      `functions/.env.${projectId} declares no BACKEND_URL`
    ).toBeTruthy();

    expect(
      backendUrl?.replace(/\/$/, ''),
      'the functions mint their OIDC token for BACKEND_URL and the backend only accepts ' +
        'INTERNAL_TRIGGER_AUDIENCE. A mismatch 401s every trigger and says nothing useful ' +
        'in either log'
    ).toBe(audience.replace(/\/$/, ''));
  });
});
