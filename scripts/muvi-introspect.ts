import 'dotenv/config';
import { MuviTokenHandler } from '../src/lib/muvi/client';

/**
 * Quick script to verify custom_field_data returns "Year of Production".
 * Usage: npx tsx scripts/muvi-introspect.ts
 */
async function main(): Promise<void> {
  const secretKey = process.env.MUVI_SECRET_KEY;
  const appId = process.env.MUVI_APP_ID;
  const baseUrl = process.env.MUVI_BASE_URL || 'https://apigateway.muvi.com';

  if (!secretKey || !appId) {
    console.error('Missing MUVI_SECRET_KEY or MUVI_APP_ID in .env');
    process.exit(1);
  }

  const client = new MuviTokenHandler({ secretKey, appId, baseUrl });

  console.log('\n=== MUVI Custom Field Verification ===\n');

  console.log('Authenticating...');
  const token = await client.getAccessToken();
  console.log('OK\n');

  const query = `{
    contentList(
      app_token: "${token}",
      product_key: "${client.productKey}",
      ip_address: "0.0.0.0",
      per_page: 5
    ) {
      content_list {
        content_uuid
        content_name
        content_created_date
        custom_field_data { custom_field_name custom_field_value }
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

  type ContentItem = {
    content_uuid: string;
    content_name: string;
    content_created_date: string;
    custom_field_data: Array<{ custom_field_name: string; custom_field_value: string }> | null;
  };

  const raw = await response.json() as {
    data?: { contentList?: { content_list?: ContentItem[] } };
  };
  const movies = raw?.data?.contentList?.content_list || [];

  for (const movie of movies) {
    const yearField = movie.custom_field_data?.find(
      (f) => f.custom_field_name === 'Year of Production'
    );
    const year = yearField?.custom_field_value || '(not set)';
    const fallback = movie.content_created_date?.slice(0, 4) || '?';
    console.log(`${movie.content_name}`);
    console.log(`  Year of Production: ${year}  (fallback: ${fallback})\n`);
  }

  console.log('=== Done ===\n');
}

main().catch((err) => {
  console.error('Error:', err instanceof Error ? err.message : err);
  process.exit(1);
});
