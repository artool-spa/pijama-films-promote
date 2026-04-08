#!/usr/bin/env npx tsx
/**
 * Push .env variables to Google Cloud Secret Manager.
 *
 * Reads the local .env, filters to production-relevant variables,
 * and creates or updates them in Secret Manager.
 *
 * Usage: yarn deploy:cloudrun:secrets
 *
 * Prerequisites:
 *   - gcloud CLI authenticated
 *   - Secret Manager API enabled (run gcp-setup.sh first)
 */

import { config } from "dotenv";
import { resolve } from "path";
import { execSync } from "child_process";

config({ path: resolve(process.cwd(), ".env") });

// Configuration
const GCP_PROJECT = process.env.GCP_PROJECT || "pijama-films";

// Variables to push to Secret Manager (same list as coolify-push-env.ts)
const ENV_KEYS = [
  // Auth
  "JWT_SECRET_KEY",
  "JWT_EXPIRATION_TIME",
  // Muvi
  "MUVI_APP_ID",
  "MUVI_SECRET_KEY",
  "MUVI_IP_ADDRESS",
  // Google Cloud Storage
  "GCS_BUCKET_NAME",
  "GCS_SERVICE_ACCOUNT_KEY_JSON",
  // Meta / Facebook Ads
  "META_ACCESS_TOKEN",
  "META_AD_ACCOUNT_ID",
  "META_APP_SECRET",
  "META_APP_ID",
  "META_PIXEL_ID",
  "META_PAGE_ID",
  "META_API_VERSION",
  "META_BASE_URL",
  // Google Ads
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  // Mercure
  "MERCURE_URL",
  "MERCURE_JWT_SECRET",
  // Stripe
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  // Database
  "DATABASE_URL",
  // Cron
  "CRON_SECRET",
];

function exec(command: string, input?: string): string {
  try {
    return execSync(command, {
      encoding: "utf-8",
      input,
      stdio: input ? ["pipe", "pipe", "pipe"] : ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return "";
  }
}

function secretExists(name: string): boolean {
  const result = exec(
    `gcloud secrets describe ${name} --project=${GCP_PROJECT} 2>/dev/null`
  );
  return result.length > 0;
}

function createOrUpdateSecret(
  name: string,
  value: string
): "created" | "updated" {
  if (secretExists(name)) {
    // Add a new version with the updated value
    exec(
      `gcloud secrets versions add ${name} --project=${GCP_PROJECT} --data-file=-`,
      value
    );
    return "updated";
  }

  // Create the secret and set initial value
  exec(
    `gcloud secrets create ${name} --project=${GCP_PROJECT} --replication-policy=automatic --data-file=-`,
    value
  );
  return "created";
}

async function main() {
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("  Pijama Films - Push Secrets to Google Cloud Secret Manager");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log(`\n  Project: ${GCP_PROJECT}\n`);

  const results: { key: string; action: string }[] = [];

  for (const key of ENV_KEYS) {
    // Use GCP_DATABASE_URL for the DATABASE_URL secret (Cloud SQL socket format)
    const value =
      key === "DATABASE_URL"
        ? process.env.GCP_DATABASE_URL || process.env.DATABASE_URL
        : process.env[key];

    if (value === undefined) {
      console.log(`  SKIP  ${key} (not set in .env)`);
      results.push({ key, action: "skipped" });
      continue;
    }

    try {
      const action = createOrUpdateSecret(key, value);
      const symbol = action === "created" ? "+" : "~";
      console.log(`  ${symbol}     ${key} (${action})`);
      results.push({ key, action });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`  FAIL  ${key}: ${msg}`);
      results.push({ key, action: "failed" });
    }
  }

  // Summary
  const created = results.filter((r) => r.action === "created").length;
  const updated = results.filter((r) => r.action === "updated").length;
  const skipped = results.filter((r) => r.action === "skipped").length;
  const failed = results.filter((r) => r.action === "failed").length;

  console.log(
    "\n═══════════════════════════════════════════════════════════════"
  );
  console.log("  Summary");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log(`  Created:  ${created}`);
  console.log(`  Updated:  ${updated}`);
  console.log(`  Skipped:  ${skipped}`);
  if (failed > 0) console.log(`  Failed:   ${failed}`);
  console.log("");

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(
    "\n  Fatal error:",
    error instanceof Error ? error.message : error
  );
  process.exit(1);
});
