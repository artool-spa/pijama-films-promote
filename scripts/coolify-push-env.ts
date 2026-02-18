#!/usr/bin/env npx tsx
/**
 * Push .env variables to Coolify pijamafilms-app service.
 *
 * Reads the local .env, filters to production-relevant variables,
 * and creates or updates them in the Coolify application.
 *
 * Usage: yarn deploy:env
 *
 * Required environment variables:
 * - COOLIFY_TOKEN: API token from Coolify
 * - COOLIFY_URL: Coolify instance URL (default: https://app.coolify.io)
 */

import { config } from "dotenv";
import { resolve } from "path";

config({ path: resolve(process.cwd(), ".env") });

const COOLIFY_URL = process.env.COOLIFY_URL || "https://app.coolify.io";
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;
const API_BASE = `${COOLIFY_URL}/api/v1`;

const APP_SERVICE_NAME = "pijamafilms-app";
const MERCURE_SERVICE_NAME = "pijamafilms-mercure";
const APP_DOMAIN = "promote.pijamafilms.com";

// Variables to push to production (grouped by service)
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
  // Mercure (handled with production overrides)
  "MERCURE_URL",
  "NEXT_PUBLIC_MERCURE_URL",
  "MERCURE_JWT_SECRET",
  // Stripe
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
];

interface Application {
  uuid: string;
  name: string;
  fqdn?: string;
  status: string;
}

interface EnvVar {
  uuid: string;
  key: string;
  value: string;
}

async function coolifyFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${COOLIFY_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...options.headers,
    },
  });

  const text = await response.text();

  if (!response.ok) {
    return { ok: false, status: response.status, error: text };
  }

  const data = text ? (JSON.parse(text) as T) : ({} as T);
  return { ok: true, data };
}

async function findApp(name: string): Promise<Application> {
  const result = await coolifyFetch<Application[]>("/applications");
  if (!result.ok) throw new Error(`Failed to list applications: ${result.error}`);

  const app = result.data.find((a) => a.name === name);
  if (!app) throw new Error(`Application "${name}" not found in Coolify`);
  return app;
}

async function getExistingEnvs(appUuid: string): Promise<EnvVar[]> {
  const result = await coolifyFetch<EnvVar[]>(`/applications/${appUuid}/envs`);
  if (!result.ok) throw new Error(`Failed to list envs: ${result.error}`);
  return result.data;
}

async function setEnvVar(
  appUuid: string,
  key: string,
  value: string,
  existingKeys: Set<string>
): Promise<"created" | "updated"> {
  if (existingKeys.has(key)) {
    // Update existing env var (PATCH uses key in body, not UUID in path)
    const result = await coolifyFetch(`/applications/${appUuid}/envs`, {
      method: "PATCH",
      body: JSON.stringify({ key, value, is_preview: false }),
    });
    if (!result.ok) throw new Error(`Failed to update ${key}: ${result.error}`);
    return "updated";
  }

  // Create new env var
  const result = await coolifyFetch(`/applications/${appUuid}/envs`, {
    method: "POST",
    body: JSON.stringify({ key, value, is_preview: false }),
  });
  if (!result.ok) throw new Error(`Failed to create ${key}: ${result.error}`);
  return "created";
}

function getMercureOverrides(mercureUuid: string): Record<string, string> {
  return {
    MERCURE_URL: `http://${mercureUuid}:3001/.well-known/mercure`,
    NEXT_PUBLIC_MERCURE_URL: `https://${APP_DOMAIN}/.well-known/mercure`,
  };
}

async function main() {
  console.log("===================================================================");
  console.log("  Pijama Films - Push Environment Variables to Coolify");
  console.log("===================================================================");

  if (!COOLIFY_TOKEN) {
    console.error("\n   COOLIFY_TOKEN is required");
    process.exit(1);
  }

  // Find pijamafilms-app
  console.log("\n   Looking up applications...");
  const app = await findApp(APP_SERVICE_NAME);
  console.log(`   Found: ${APP_SERVICE_NAME} (${app.uuid})`);

  // Find pijamafilms-mercure for internal URL
  let mercureOverrides: Record<string, string> = {};
  try {
    const mercureApp = await findApp(MERCURE_SERVICE_NAME);
    console.log(`   Found: ${MERCURE_SERVICE_NAME} (${mercureApp.uuid})`);
    mercureOverrides = getMercureOverrides(mercureApp.uuid);
  } catch {
    console.warn(`   Warning: ${MERCURE_SERVICE_NAME} not found. Mercure URLs will use .env values.`);
  }

  // Get existing env vars to determine create vs update
  const existingEnvs = await getExistingEnvs(app.uuid);
  const existingKeys = new Set(existingEnvs.map((e) => e.key));
  console.log(`   Existing env vars: ${existingEnvs.length}`);

  // Push each env var
  console.log("\n   Pushing environment variables...\n");
  const results: { key: string; action: string }[] = [];

  for (const key of ENV_KEYS) {
    // Use Mercure production override if available, otherwise use .env value
    const value = mercureOverrides[key] ?? process.env[key];

    if (value === undefined) {
      console.log(`   SKIP  ${key} (not set in .env)`);
      results.push({ key, action: "skipped" });
      continue;
    }

    try {
      const action = await setEnvVar(app.uuid, key, value, existingKeys);
      const symbol = action === "created" ? "+" : "~";
      console.log(`   ${symbol}     ${key} (${action})`);
      results.push({ key, action });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error(`   FAIL  ${key}: ${msg}`);
      results.push({ key, action: "failed" });
    }
  }

  // Summary
  const created = results.filter((r) => r.action === "created").length;
  const updated = results.filter((r) => r.action === "updated").length;
  const skipped = results.filter((r) => r.action === "skipped").length;
  const failed = results.filter((r) => r.action === "failed").length;

  console.log("\n===================================================================");
  console.log("  Summary");
  console.log("===================================================================");
  console.log(`   Created:  ${created}`);
  console.log(`   Updated:  ${updated}`);
  console.log(`   Skipped:  ${skipped}`);
  if (failed > 0) console.log(`   Failed:   ${failed}`);

  if (Object.keys(mercureOverrides).length > 0) {
    console.log("\n   Mercure production overrides applied:");
    for (const [key, value] of Object.entries(mercureOverrides)) {
      console.log(`     ${key} = ${value}`);
    }
  }

  console.log("");

  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error("\n   Fatal error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
