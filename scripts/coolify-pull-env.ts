#!/usr/bin/env npx tsx
/**
 * Pull environment variables from Coolify pijamafilms-app to .env.prod.
 *
 * Fetches all env vars from the Coolify application and writes them
 * to a local .env.prod file.
 *
 * Usage: yarn deploy:pull-env
 *
 * Required environment variables:
 * - COOLIFY_TOKEN: API token from Coolify
 * - COOLIFY_URL: Coolify instance URL (default: https://app.coolify.io)
 */

import { config } from "dotenv";
import { resolve } from "path";
import { writeFileSync } from "fs";

config({ path: resolve(process.cwd(), ".env") });

const COOLIFY_URL = (process.env.COOLIFY_URL || "https://app.coolify.io").replace(/\/+$/, "");
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;
const API_BASE = `${COOLIFY_URL}/api/v1`;

const APP_SERVICE_NAME = "pijamafilms-app";

interface Application {
  uuid: string;
  name: string;
}

interface EnvVar {
  uuid: string;
  key: string;
  value: string;
}

async function coolifyFetch<T>(
  endpoint: string
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const url = `${API_BASE}${endpoint}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${COOLIFY_TOKEN}`,
      "Content-Type": "application/json",
      Accept: "application/json",
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

async function getEnvVars(appUuid: string): Promise<EnvVar[]> {
  const result = await coolifyFetch<EnvVar[]>(`/applications/${appUuid}/envs`);
  if (!result.ok) throw new Error(`Failed to list envs: ${result.error}`);
  return result.data;
}

function formatEnvValue(value: string): string {
  // Quote values that contain spaces, quotes, or special shell characters
  if (/[\s"'`$\\#!]/.test(value) || value === "") {
    const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  return value;
}

async function main() {
  console.log("===================================================================");
  console.log("  Pijama Films - Pull Environment Variables from Coolify");
  console.log("===================================================================");

  if (!COOLIFY_TOKEN) {
    console.error("\n   COOLIFY_TOKEN is required");
    process.exit(1);
  }

  // Find pijamafilms-app
  console.log("\n   Looking up application...");
  const app = await findApp(APP_SERVICE_NAME);
  console.log(`   Found: ${APP_SERVICE_NAME} (${app.uuid})`);

  // Fetch env vars
  console.log("   Fetching environment variables...\n");
  const envVars = await getEnvVars(app.uuid);

  if (envVars.length === 0) {
    console.log("   No environment variables found.");
    return;
  }

  // Deduplicate by key (last value wins — production overrides preview)
  const envMap = new Map<string, string>();
  for (const env of envVars) {
    envMap.set(env.key, env.value);
  }

  // Sort alphabetically for readability
  const uniqueKeys = [...envMap.keys()].sort();

  // Build .env.prod content
  const lines = uniqueKeys.map((key) => `${key}=${formatEnvValue(envMap.get(key)!)}`);
  const content = `# Production environment variables pulled from Coolify\n# Generated: ${new Date().toISOString()}\n\n${lines.join("\n")}\n`;

  const outputPath = resolve(process.cwd(), ".env.prod");
  writeFileSync(outputPath, content, "utf-8");

  // Print summary
  for (const key of uniqueKeys) {
    const value = envMap.get(key)!;
    const preview = value.length > 40 ? value.slice(0, 37) + "..." : value;
    console.log(`   ${key}=${preview}`);
  }

  console.log("\n===================================================================");
  console.log(`  Wrote ${uniqueKeys.length} variables to .env.prod`);
  console.log("===================================================================\n");
}

main().catch((error) => {
  console.error("\n   Fatal error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
