import 'dotenv/config';
import * as http from 'node:http';
import { OAuth2Client } from 'google-auth-library';

const SCOPES = [
  'https://www.googleapis.com/auth/adwords',
  'https://www.googleapis.com/auth/youtube.upload',
  'https://www.googleapis.com/auth/youtube',
];

const PORT = 3333;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

async function main(): Promise<void> {
  const clientId = process.env.GOOGLE_ADS_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error(
      'Missing GOOGLE_ADS_CLIENT_ID or GOOGLE_ADS_CLIENT_SECRET in .env'
    );
    process.exit(1);
  }

  const oauth2Client = new OAuth2Client(clientId, clientSecret, REDIRECT_URI);

  const authorizeUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: SCOPES,
  });

  console.log('\n=== Google OAuth2 Token Generator ===\n');
  console.log('1. Make sure this redirect URI is authorized in Google Cloud Console:');
  console.log(`   ${REDIRECT_URI}\n`);
  console.log('2. Open this URL in your browser:\n');
  console.log(`   ${authorizeUrl}\n`);
  console.log('Waiting for authorization...\n');

  const code = await waitForAuthCode();
  console.log('Authorization code received. Exchanging for tokens...\n');

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      'No refresh token received. Make sure prompt=consent is set and the app is not already authorized.'
    );
    process.exit(1);
  }

  console.log('=== New Refresh Token ===\n');
  console.log(tokens.refresh_token);
  console.log('\nUpdate your .env file:');
  console.log(`GOOGLE_ADS_REFRESH_TOKEN=${tokens.refresh_token}\n`);
}

function waitForAuthCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

      if (url.pathname !== '/oauth2callback') {
        res.writeHead(404);
        res.end('Not found');
        return;
      }

      const error = url.searchParams.get('error');
      if (error) {
        res.writeHead(400);
        res.end(`Authorization failed: ${error}`);
        server.close();
        reject(new Error(`Authorization failed: ${error}`));
        return;
      }

      const code = url.searchParams.get('code');
      if (!code) {
        res.writeHead(400);
        res.end('Missing authorization code');
        server.close();
        reject(new Error('Missing authorization code'));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<h1>Authorization successful!</h1><p>You can close this tab.</p>');
      server.close();
      resolve(code);
    });

    server.listen(PORT, () => {
      // Server is ready
    });
  });
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
