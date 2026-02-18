import 'dotenv/config';
import { MuviTokenHandler } from '../src/lib/muvi/client';

async function main(): Promise<void> {
  const secretKey = process.env.MUVI_SECRET_KEY;
  const appId = process.env.MUVI_APP_ID;
  const baseUrl = process.env.MUVI_BASE_URL || 'https://apigateway.muvi.com';

  if (!secretKey || !appId) {
    console.error('Missing MUVI_SECRET_KEY or MUVI_APP_ID');
    process.exit(1);
  }

  // Resolve public IP for geo-blocking
  let ipAddress = '0.0.0.0';
  try {
    const ipResp = await fetch('https://api.ipify.org');
    ipAddress = (await ipResp.text()).trim();
  } catch {
    // fallback
  }
  console.log(`Using IP: ${ipAddress}\n`);

  const client = new MuviTokenHandler({ secretKey, appId, baseUrl });
  const token = await client.getAccessToken();

  const query = `{
    contentList(
      app_token: "${token}",
      product_key: "${client.productKey}",
      per_page: 100,
      ip_address: "${ipAddress}"
    ) {
      page_info { total_count }
      content_list {
        content_uuid
        content_name
        content_status
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (await response.json()) as any;
  const movies = raw?.data?.contentList?.content_list || [];

  console.log(`Total movies: ${movies.length}\n`);
  for (const m of movies) {
    console.log(`  ${m.content_name} => content_status: ${JSON.stringify(m.content_status)} (type: ${typeof m.content_status})`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const statuses = [...new Set(movies.map((m: any) => JSON.stringify(m.content_status)))];
  console.log(`\nUnique content_status values: ${statuses.join(', ')}`);
}

main().catch(console.error);
