import dns from 'node:dns';

export function register() {
  // Use Google DNS to avoid Docker network DNS resolution issues
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}
