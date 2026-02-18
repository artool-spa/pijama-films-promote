import 'dotenv/config';
import { execSync } from 'child_process';
import { mkdirSync } from 'fs';
import { MuviTokenHandler } from '../src/lib/muvi/client';
import { getMovieDetails } from '../src/lib/muvi/api';

const DEFAULT_UUID = '1423df88449a4cb9a6d8becbdd76bed5';
const OUTPUT_DIR = 'scripts/output';
const OUTPUT_FILE = `${OUTPUT_DIR}/trailer-formatted.mp4`;

/**
 * Extract trailer URL using the same priority as the film model:
 * mpeg_path > file_url > hls_path > third_party_url
 */
function getTrailerUrl(
  trailerDetails?: { mpeg_path?: string; file_url?: string; hls_path?: string; third_party_url?: string } | null
): string {
  if (!trailerDetails) return '';
  return (
    trailerDetails.mpeg_path ||
    trailerDetails.file_url ||
    trailerDetails.hls_path ||
    trailerDetails.third_party_url ||
    ''
  );
}

async function main(): Promise<void> {
  const contentUuid = process.argv[2] || DEFAULT_UUID;

  console.log('\n=== Trailer Format Tool ===\n');
  console.log(`Target content_uuid: ${contentUuid}\n`);

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
  await client.getAccessToken();
  console.log('   OK\n');

  // Step 2: Fetch movie details
  console.log('2. Fetching movie details...');
  const movie = await getMovieDetails(client, contentUuid);

  if (!movie) {
    console.error(`   Movie not found: ${contentUuid}`);
    process.exit(1);
  }
  console.log(`   Found: ${movie.content_name}\n`);

  // Step 3: Extract trailer URL
  console.log('3. Extracting trailer URL...');
  const trailerUrl = getTrailerUrl(movie.trailer_details as any);

  if (!trailerUrl) {
    console.error('   No trailer URL found in movie details');
    process.exit(1);
  }
  console.log(`   URL: ${trailerUrl}\n`);

  // Step 4: Create output directory
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // Step 5: Run ffmpeg
  const ffmpegCmd = [
    'ffmpeg', '-y',
    '-i', `"${trailerUrl}"`,
    '-t', '60',
    '-vf', '"scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black"',
    '-c:v', 'libx264',
    '-c:a', 'aac',
    `"${OUTPUT_FILE}"`,
  ].join(' ');

  console.log('4. Running ffmpeg...');
  console.log(`   Command: ${ffmpegCmd}\n`);

  execSync(ffmpegCmd, { stdio: 'inherit' });

  console.log(`\nDone! Output: ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
