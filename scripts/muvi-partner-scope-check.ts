/**
 * Does Muvi's `user_uuid` filter scope the catalogue to a PARTNER?
 *
 * Why this matters: `getFilms()` pages against Muvi's global catalogue, and
 * `GetMoviesOptions` offers no partner argument. If the partner filter has to
 * be applied on our side, pagination has to be inverted — resolve the partner's
 * uuid list first, fetch each title, paginate locally — because filtering a
 * 12-item Muvi page against a 3-title partner yields 1 result on page 1 and 0
 * on page 2 while `totalCount` reports the whole catalogue.
 *
 * `contentList` accepts a `user_uuid` filter (src/lib/muvi/api.ts) that nothing
 * in the app has ever passed, and Atlas hands us a partner-level `muviUuid`
 * (src/lib/atlas/types.ts). If `user_uuid` means "the partner who owns this
 * content", the filter belongs upstream and `getFilms` keeps its signature and
 * its real `totalCount`. If it means "the viewer" — which is the usual reading
 * in Muvi's API — it is useless for this and we filter locally.
 *
 * ## Three arms, because one measurement cannot answer this
 *
 * The obvious test — call it with a partner uuid and see what comes back — is
 * not interpretable on its own. The account available for testing reports
 * `movieCount: 0` from Atlas, so a CORRECT owner filter and a SILENTLY IGNORED
 * unknown parameter can both plausibly produce a number, and "0 results" would
 * be read as success by someone hoping for it. So:
 *
 *   A. no filter      -> the catalogue size, the baseline
 *   B. partner uuid   -> the real question
 *   C. a nonsense uuid-shaped value -> the control
 *
 * Reading the three together:
 *
 *   B == C == A  -> the parameter is ignored. Definitive NO.
 *   B == A, C 0  -> it filters by something the partner value matches broadly;
 *                   not ownership. Suspect "viewer".
 *   B < A, C 0   -> it filters. Ownership is PLAUSIBLE, not proven: confirm by
 *                   checking `content_created_by` on the returned titles, and
 *                   by re-running with a partner known to own titles.
 *   B == C == 0  -> it filters everything out; consistent with ownership when
 *                   the partner owns nothing, but equally consistent with the
 *                   value simply never matching. NOT an answer on its own.
 *
 * ## Safety
 *
 * Read-only. It issues Muvi `contentList` queries and touches no database —
 * emphatically not Firestore. Credentials are read from the local `.env` by
 * dotenv and never printed, logged or passed on a command line; the access
 * token is never echoed. Nothing here writes anything anywhere.
 *
 * If Muvi rejects the call, read WHO answered before concluding anything: the
 * Muvi application replies with its own JSON envelope (`{code, status, ...}`)
 * for a credential or IP problem, whereas an outage answers from the
 * infrastructure (`server: awselb/2.0`, CloudFront HTML). They are different
 * findings and have been confused here before.
 *
 * Usage:
 *   npx tsx scripts/muvi-partner-scope-check.ts <partner-muvi-uuid> [env-path]
 */
import { config } from 'dotenv';
import path from 'node:path';
import { MuviTokenHandler } from '../src/lib/muvi/client';

const PER_PAGE = 50;

/** A well-formed uuid that belongs to nobody — the control arm. */
const CONTROL_UUID = '00000000000000000000000000000000';

type Movie = {
  content_uuid?: string;
  content_name?: string | null;
  content_created_by?: string | null;
};

type Arm = {
  label: string;
  totalCount: number | null;
  returned: number;
  movies: Movie[];
  error?: string;
};

function buildQuery(token: string, productKey: string, userUuid?: string): string {
  const filters = [
    `per_page: ${PER_PAGE}`,
    ...(userUuid ? [`user_uuid: "${userUuid}"`] : []),
  ].join(', ');

  return `{
    contentList(
      app_token: "${token}",
      product_key: "${productKey}",
      ip_address: "0.0.0.0",
      ${filters}
    ) {
      page_info { total_count }
      content_list { content_uuid content_name content_created_by }
    }
  }`;
}

async function runArm(
  baseUrl: string,
  token: string,
  productKey: string,
  label: string,
  userUuid?: string
): Promise<Arm> {
  const response = await fetch(`${baseUrl}/content`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query: buildQuery(token, productKey, userUuid) }),
  });

  // Who answered? The Muvi application and the infrastructure in front of it
  // fail in ways that look alike in a log and mean opposite things.
  const server = response.headers.get('server') ?? '(none)';
  const contentType = response.headers.get('content-type') ?? '(none)';

  const raw = (await response.json().catch(() => null)) as {
    data?: { contentList?: { page_info?: { total_count?: number }; content_list?: Movie[] } };
    errors?: unknown;
    code?: number;
    status?: string;
    message?: string;
  } | null;

  if (!raw || raw.errors || raw.status === 'FAILED' || !raw.data?.contentList) {
    return {
      label,
      totalCount: null,
      returned: 0,
      movies: [],
      error:
        `HTTP ${response.status} · server: ${server} · content-type: ${contentType} · ` +
        `body: ${JSON.stringify(raw)?.slice(0, 400) ?? '(unparseable)'}`,
    };
  }

  const list = raw.data.contentList;

  return {
    label,
    totalCount: list.page_info?.total_count ?? null,
    returned: list.content_list?.length ?? 0,
    movies: list.content_list ?? [],
  };
}

function describe(arm: Arm): void {
  if (arm.error) {
    console.log(`  ${arm.label.padEnd(24)} ERROR  ${arm.error}`);
    return;
  }

  console.log(
    `  ${arm.label.padEnd(24)} total_count=${String(arm.totalCount).padEnd(6)} returned=${arm.returned}`
  );

  for (const movie of arm.movies.slice(0, 5)) {
    console.log(
      `      - ${(movie.content_name ?? '(untitled)').slice(0, 48).padEnd(50)} ` +
        `created_by=${movie.content_created_by ?? '(null)'}`
    );
  }
}

async function main(): Promise<void> {
  const partnerUuid = process.argv[2];

  if (!partnerUuid) {
    console.error('Usage: npx tsx scripts/muvi-partner-scope-check.ts <partner-muvi-uuid> [env-path]');
    process.exit(1);
  }

  // The repo's own .env by default; an explicit path lets this run from a
  // worktree that has none. A path is not a secret; the values behind it are
  // loaded by dotenv and never surface in this process's output.
  config({ path: process.argv[3] ?? path.resolve(__dirname, '../.env') });

  const secretKey = process.env.MUVI_SECRET_KEY;
  const appId = process.env.MUVI_APP_ID;
  const baseUrl = process.env.MUVI_BASE_URL || 'https://apigateway.muvi.com';

  if (!secretKey || !appId) {
    console.error('Missing MUVI_SECRET_KEY or MUVI_APP_ID. Point the second argument at a .env that has them.');
    process.exit(1);
  }

  const client = new MuviTokenHandler({ secretKey, appId, baseUrl });

  console.log('\n=== Muvi user_uuid scope check ===\n');
  console.log(`base url:     ${baseUrl}`);
  console.log(`partner uuid: ${partnerUuid}`);
  console.log(`control uuid: ${CONTROL_UUID}\n`);

  const token = await client.getAccessToken();
  const productKey = client.productKey;

  const armA = await runArm(baseUrl, token, productKey, 'A · no filter');
  const armB = await runArm(baseUrl, token, productKey, 'B · partner uuid', partnerUuid);
  const armC = await runArm(baseUrl, token, productKey, 'C · control uuid', CONTROL_UUID);

  console.log('Results:\n');
  [armA, armB, armC].forEach(describe);

  console.log('\nReading:\n');

  if (armA.error || armB.error || armC.error) {
    console.log('  INCONCLUSIVE — at least one arm failed. Check WHO answered (see the');
    console.log('  header note above) before reporting this as a Muvi defect.');
    return;
  }

  const [a, b, c] = [armA.totalCount, armB.totalCount, armC.totalCount];

  if (a === b && b === c) {
    console.log('  NO — user_uuid is ignored: all three arms return the same count.');
    console.log('  The partner filter cannot be pushed upstream. Filter locally and');
    console.log('  invert getFilms() pagination.');
  } else if (b === a && c !== a) {
    console.log('  NO — the parameter filters, but the partner value matches everything,');
    console.log('  so it is not ownership. Most likely a viewer/entitlement filter.');
  } else if (b === 0 && c === 0 && a !== 0) {
    console.log('  INCONCLUSIVE — both the partner uuid and a nonsense uuid return zero.');
    console.log('  Consistent with ownership for a partner who owns nothing, and equally');
    console.log('  consistent with the value never matching. Re-run with a partner KNOWN');
    console.log('  to own titles before drawing any conclusion.');
  } else if (b !== a && c === 0) {
    console.log('  PLAUSIBLE YES — the filter discriminates and the partner value selects');
    console.log('  a subset. Confirm with content_created_by above and with a second');
    console.log('  partner before changing the plan.');
  } else {
    console.log('  UNEXPECTED combination. Report the three counts verbatim; do not');
    console.log('  interpret them here.');
  }

  console.log('');
}

main().catch((error) => {
  console.error('Scope check failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
