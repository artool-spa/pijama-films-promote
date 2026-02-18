import 'dotenv/config';
import { MuviTokenHandler } from '../src/lib/muvi/client';
import { getMovies, getMovieDetails } from '../src/lib/muvi/api';
import { MuviContentListResponseSchema } from '../src/lib/muvi/types';

const DEFAULT_UUID = '1423df88449a4cb9a6d8becbdd76bed5';
const IP_ADDRESS = process.argv[3] || 'auto';

async function main(): Promise<void> {
  const contentUuid = process.argv[2] || DEFAULT_UUID;

  // Resolve IP address
  let ipAddress = IP_ADDRESS;
  if (ipAddress === 'auto') {
    try {
      const ipResp = await fetch('https://api.ipify.org');
      ipAddress = (await ipResp.text()).trim();
    } catch {
      ipAddress = '0.0.0.0';
    }
  }

  console.log('\n=== MUVI Movie Diagnostic ===\n');
  console.log(`Target content_uuid: ${contentUuid}`);
  console.log(`Using ip_address:    ${ipAddress}\n`);

  // Validate env vars
  const secretKey = process.env.MUVI_SECRET_KEY;
  const appId = process.env.MUVI_APP_ID;
  const baseUrl = process.env.MUVI_BASE_URL || 'https://apigateway.muvi.com';

  if (!secretKey || !appId) {
    console.error('Missing MUVI_SECRET_KEY or MUVI_APP_ID in .env');
    process.exit(1);
  }

  const client = new MuviTokenHandler({ secretKey, appId, baseUrl });

  // Step 1: Authenticate
  console.log('1. Authenticating with MUVI...');
  try {
    await client.getAccessToken();
    console.log('   OK - authenticated\n');
  } catch (error) {
    console.error('   FAILED -', error instanceof Error ? error.message : error);
    process.exit(1);
  }

  // Step 2: Fetch movie by content_uuid
  console.log('2. Fetching movie details by content_uuid...');
  try {
    const movie = await getMovieDetails(client, contentUuid);

    if (movie) {
      console.log('   FOUND - movie exists in MUVI\n');
      console.log('   Details:');
      console.log(`     content_uuid:   ${movie.content_uuid}`);
      console.log(`     content_id:     ${movie.content_id ?? '(null)'}`);
      console.log(`     content_name:   ${movie.content_name}`);
      console.log(`     content_status: ${movie.content_status ?? '(null)'}`);
      console.log(`     content_accessibility: ${movie.content_accessibility ?? '(null)'}`);
      console.log(`     content_asset_type: ${movie.content_asset_type ?? '(null)'}`);
      console.log(`     is_encoded:     ${movie.is_encoded ?? '(null)'}`);
      console.log(`     is_parent:      ${movie.is_parent ?? '(null)'}`);
      console.log(`     content_created_date: ${movie.content_created_date ?? '(null)'}`);
      console.log(`     content_updated_date: ${movie.content_updated_date ?? '(null)'}`);
      console.log(`     serial_number:  ${movie.serial_number ?? '(null)'}`);
      console.log(`     categories:     ${JSON.stringify(movie.categories)}`);
      console.log('');
    } else {
      console.log('   NOT FOUND - movie does not exist or returned empty content_list\n');
    }
  } catch (error) {
    console.error('   ERROR -', error instanceof Error ? error.message : error);
    console.log('');
  }

  // Step 3: Fetch raw API response (bypass Zod) to check for validation issues
  console.log('3. Fetching raw API response (bypass Zod validation)...');
  try {
    const token = await client.getAccessToken();
    const query = `{
      contentList(
        app_token: "${token}",
        product_key: "${client.productKey}",
        content_uuid: "${contentUuid}",
        ip_address: "${ipAddress}"
      ) {
        page_info { total_count }
        content_list {
          content_uuid
          content_name
          content_status
          content_accessibility
          content_asset_type
          is_encoded
          is_parent
        }
      }
    }`;

    const response = await fetch(`${baseUrl}/content`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query }),
    });

    const raw = await response.json();
    console.log('   Raw response:');
    console.log(JSON.stringify(raw, null, 2));

    // Try Zod validation to see if it fails
    const zodResult = MuviContentListResponseSchema.safeParse(raw);
    if (zodResult.success) {
      console.log('\n   Zod validation: PASSED');
    } else {
      console.log('\n   Zod validation: FAILED');
      console.log('   Issues:');
      for (const issue of zodResult.error.issues) {
        console.log(`     - ${issue.path.join('.')}: ${issue.message}`);
      }
    }
    console.log('');
  } catch (error) {
    console.error('   ERROR -', error instanceof Error ? error.message : error);
    console.log('');
  }

  // Step 4: Fetch all movies from the list and check if target appears
  console.log('4. Scanning full movie list for target movie...');
  try {
    let page = 1;
    const perPage = 100;
    let totalCount = 0;
    let found = false;
    let allMoviesCount = 0;

    while (true) {
      const result = await getMovies(client, { page, perPage });
      totalCount = result.totalCount;
      allMoviesCount += result.movies.length;

      const match = result.movies.find((m) => m.content_uuid === contentUuid);
      if (match) {
        found = true;
        console.log(`   FOUND on page ${page} - movie appears in list`);
        console.log(`     content_name:   ${match.content_name}`);
        console.log(`     content_status: ${match.content_status ?? '(null)'}`);
        break;
      }

      if (result.movies.length < perPage) {
        break;
      }
      page++;
    }

    if (!found) {
      console.log('   NOT FOUND - movie does not appear in any page of the list');
    }

    console.log(`\n   Total movies reported by API: ${totalCount}`);
    console.log(`   Total movies fetched: ${allMoviesCount}`);
    console.log(`   Pages scanned: ${page}`);
  } catch (error) {
    console.error('   ERROR -', error instanceof Error ? error.message : error);
  }

  console.log('\n=== Done ===\n');
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
