#!/usr/bin/env npx tsx
/**
 * Deploy Caddy + Mercure on the GCE gateway VM.
 *
 * The VM acts as the front door for promote.pijamafilms.com:
 * - Caddy handles TLS (Let's Encrypt) and reverse proxying
 * - /.well-known/mercure -> Mercure (localhost:3001)
 * - Everything else -> Cloud Run service
 *
 * Usage: yarn deploy:cloudrun:mercure
 *        yarn deploy:cloudrun:mercure --force-rotate-secret
 *        yarn deploy:cloudrun:mercure --update
 *
 * Prerequisites:
 *   - gcloud CLI authenticated
 *   - GCP infrastructure set up (run gcp-setup.sh first)
 *   - Cloud Run app deployed (run deploy:cloudrun first)
 */

import { config } from "dotenv";
import { resolve } from "path";
import { execSync, spawnSync } from "child_process";

config({ path: resolve(process.cwd(), ".env") });

// Configuration
const GCP_PROJECT = process.env.GCP_PROJECT || "pijama-films";
const GCP_REGION = process.env.GCP_REGION || "us-west1";
const GCP_ZONE = process.env.GCP_ZONE || `${GCP_REGION}-a`;
const VM_NAME = "pijama-gateway";
const CLOUD_RUN_SERVICE = "pijamafilms-app";
const APP_DOMAIN = "promote.pijamafilms.com";

function execOutput(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

function execLive(command: string): boolean {
  return spawnSync(command, { shell: true, stdio: "inherit" }).status === 0;
}

function generatePassword(length = 48): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let password = "";
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    password += chars[randomValues[i] % chars.length];
  }
  return password;
}

function getJwtSecret(forceRotate: boolean): string {
  if (forceRotate) {
    const secret = generatePassword(48);
    execSync(
      `gcloud secrets versions add MERCURE_JWT_SECRET --project=${GCP_PROJECT} --data-file=-`,
      { input: secret, stdio: ["pipe", "pipe", "pipe"] }
    );
    console.log("  New JWT secret stored in Secret Manager.");
    return secret;
  }

  // Try existing secret
  const existing = execOutput(
    `gcloud secrets versions access latest --secret=MERCURE_JWT_SECRET --project=${GCP_PROJECT} 2>/dev/null`
  );
  if (existing) return existing;

  // Create new
  const secret = generatePassword(48);
  console.log("  Generated new Mercure JWT secret.");
  const secretExists = execOutput(
    `gcloud secrets describe MERCURE_JWT_SECRET --project=${GCP_PROJECT} 2>/dev/null`
  );
  if (secretExists) {
    execSync(
      `gcloud secrets versions add MERCURE_JWT_SECRET --project=${GCP_PROJECT} --data-file=-`,
      { input: secret, stdio: ["pipe", "pipe", "pipe"] }
    );
  } else {
    execSync(
      `gcloud secrets create MERCURE_JWT_SECRET --project=${GCP_PROJECT} --replication-policy=automatic --data-file=-`,
      { input: secret, stdio: ["pipe", "pipe", "pipe"] }
    );
  }
  return secret;
}

function getCloudRunUrl(): string {
  const url = execOutput(
    `gcloud run services describe ${CLOUD_RUN_SERVICE} --region=${GCP_REGION} --project=${GCP_PROJECT} --format="value(status.url)"`
  );
  if (!url) {
    throw new Error(
      `Cloud Run service '${CLOUD_RUN_SERVICE}' not found. Run yarn deploy:cloudrun first.`
    );
  }
  return url;
}

function buildCaddyfile(cloudRunUrl: string): string {
  // Listen on HTTP port 80 — TLS is terminated by Traefik on Coolify
  return `:80 {
  handle /.well-known/mercure* {
    reverse_proxy localhost:3001
  }

  handle {
    reverse_proxy ${cloudRunUrl} {
      header_up Host {upstream_hostport}
    }
  }
}
`;
}

function sshCommand(command: string): boolean {
  return execLive(
    `gcloud compute ssh ${VM_NAME} --zone=${GCP_ZONE} --project=${GCP_PROJECT} --tunnel-through-iap --command='${command}'`
  );
}

function deployMercure(jwtSecret: string): void {
  console.log("\n  Deploying Mercure container...");

  // Write a deploy script to the VM to avoid SSH quoting issues
  const script = [
    "#!/bin/bash",
    "set -e",
    "sudo docker pull dunglas/mercure:latest",
    "sudo docker rm -f mercure 2>/dev/null || true",
    `sudo docker run -d \\`,
    `  --name mercure \\`,
    `  --restart always \\`,
    `  -p 3001:3001 \\`,
    `  -e SERVER_NAME=:3001 \\`,
    `  -e MERCURE_PUBLISHER_JWT_KEY=${jwtSecret} \\`,
    `  -e MERCURE_SUBSCRIBER_JWT_KEY=${jwtSecret} \\`,
    `  -e "MERCURE_EXTRA_DIRECTIVES=anonymous\ncors_origins https://${APP_DOMAIN}" \\`,
    `  -v mercure_data:/data \\`,
    `  -v mercure_config:/config \\`,
    `  dunglas/mercure:latest`,
  ].join("\n");

  const tmpFile = "/tmp/deploy-mercure.sh";
  require("fs").writeFileSync(tmpFile, script);

  // Copy script to VM and execute
  if (
    !execLive(
      `gcloud compute scp --tunnel-through-iap ${tmpFile} ${VM_NAME}:/tmp/deploy-mercure.sh --zone=${GCP_ZONE} --project=${GCP_PROJECT}`
    )
  ) {
    throw new Error("Failed to copy deploy script to VM");
  }

  if (!sshCommand("chmod +x /tmp/deploy-mercure.sh && /tmp/deploy-mercure.sh")) {
    throw new Error("Failed to deploy Mercure container");
  }

  require("fs").unlinkSync(tmpFile);
  console.log("  Mercure container running on port 3001.");
}

function deployCaddy(cloudRunUrl: string): void {
  console.log("\n  Configuring Caddy...");

  const caddyfile = buildCaddyfile(cloudRunUrl);

  // Write Caddyfile locally, copy to VM
  const tmpFile = "/tmp/Caddyfile";
  require("fs").writeFileSync(tmpFile, caddyfile);

  if (
    !execLive(
      `gcloud compute scp --tunnel-through-iap ${tmpFile} ${VM_NAME}:/tmp/Caddyfile --zone=${GCP_ZONE} --project=${GCP_PROJECT}`
    )
  ) {
    throw new Error("Failed to copy Caddyfile to VM");
  }

  require("fs").unlinkSync(tmpFile);

  // Move Caddyfile and reload
  if (
    !sshCommand(
      "sudo mv /tmp/Caddyfile /etc/caddy/Caddyfile && sudo systemctl reload caddy || sudo systemctl restart caddy"
    )
  ) {
    throw new Error("Failed to reload Caddy");
  }
  console.log(`  Caddy configured: ${APP_DOMAIN} -> Cloud Run + Mercure`);
}

async function main() {
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("  Pijama Films - Gateway VM Deployment (Caddy + Mercure)");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log(`\n  Project: ${GCP_PROJECT}`);
  console.log(`  VM:      ${VM_NAME}`);
  console.log(`  Domain:  ${APP_DOMAIN}`);

  const forceRotate = process.argv.includes("--force-rotate-secret");

  try {
    // Check VM exists
    const vmCheck = execOutput(
      `gcloud compute instances describe ${VM_NAME} --zone=${GCP_ZONE} --project=${GCP_PROJECT} --format="value(name)" 2>/dev/null`
    );
    if (vmCheck !== VM_NAME) {
      throw new Error(
        `VM '${VM_NAME}' not found. Run yarn deploy:gcp-setup first.`
      );
    }

    // Get Cloud Run URL
    console.log("\n  Getting Cloud Run service URL...");
    const cloudRunUrl = getCloudRunUrl();
    console.log(`  Cloud Run: ${cloudRunUrl}`);

    // Get or rotate JWT secret
    const jwtSecret = getJwtSecret(forceRotate);

    // Deploy Mercure container
    deployMercure(jwtSecret);

    // Configure and reload Caddy
    deployCaddy(cloudRunUrl);

    // Get VM IP
    const vmIp = execOutput(
      `gcloud compute addresses describe ${VM_NAME}-ip --region=${GCP_REGION} --project=${GCP_PROJECT} --format="value(address)" 2>/dev/null`
    );

    console.log(
      "\n═══════════════════════════════════════════════════════════════"
    );
    console.log("  Gateway Deployed!");
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log(`\n  VM IP:    ${vmIp}`);
    console.log(`  Domain:   https://${APP_DOMAIN}`);
    console.log(`  Mercure:  https://${APP_DOMAIN}/.well-known/mercure`);
    console.log(`  Proxying: ${cloudRunUrl}`);

    if (vmIp) {
      console.log(
        `\n  DNS: Ensure A record for ${APP_DOMAIN} -> ${vmIp}`
      );
    }
    console.log("");
  } catch (error) {
    console.error("\n  Deployment failed:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
