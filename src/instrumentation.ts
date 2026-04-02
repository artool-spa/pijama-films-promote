export async function register() {
  // Use Google DNS to avoid Docker network DNS resolution issues
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const dns = await import('node:dns');
    dns.setServers(['8.8.8.8', '8.8.4.4']);
  }
}
