#!/usr/bin/env npx tsx
/**
 * Google Cloud Run Deployment Script
 *
 * Builds the Docker image locally, pushes to Artifact Registry,
 * runs Prisma migrations, and deploys to Cloud Run.
 *
 * Usage: yarn deploy:cloudrun
 *
 * Prerequisites:
 *   - gcloud CLI authenticated
 *   - GCP infrastructure set up (run gcp-setup.sh first)
 *   - Secrets pushed to Secret Manager (run deploy:cloudrun:secrets first)
 */

import { config } from "dotenv";
import { resolve } from "path";
import { spawnSync } from "child_process";

config({ path: resolve(process.cwd(), ".env") });

// Configuration
const GCP_PROJECT = process.env.GCP_PROJECT || "pijama-films";
// Firebase Auth + Firestore may live in a different project than Cloud Run.
// Defaults to GCP_PROJECT when they are the same.
const FIREBASE_PROJECT =
  process.env.FIREBASE_PROJECT_ID || GCP_PROJECT;
const GCP_REGION = process.env.GCP_REGION || "us-west1";
const SERVICE_NAME = "pijamafilms-app";
const DB_INSTANCE = "pijama-db";
const REPO_NAME = "pijama-films";
const IMAGE_BASE = `${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT}/${REPO_NAME}/app`;
const CLOUD_SQL_CONNECTION = `${GCP_PROJECT}:${GCP_REGION}:${DB_INSTANCE}`;

// Secrets to mount from Secret Manager as environment variables
const SECRET_ENV_VARS = [
  "SESSION_SECRET",
  "JWT_SECRET_KEY",
  "JWT_EXPIRATION_TIME",
  "MUVI_APP_ID",
  "MUVI_SECRET_KEY",
  "MUVI_IP_ADDRESS",
  "GCS_BUCKET_NAME",
  "GCS_SERVICE_ACCOUNT_KEY_JSON",
  "META_ACCESS_TOKEN",
  "META_AD_ACCOUNT_ID",
  "META_APP_SECRET",
  "META_APP_ID",
  "META_PIXEL_ID",
  "META_PAGE_ID",
  "META_API_VERSION",
  "META_BASE_URL",
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
  "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "DATABASE_URL",
  "CRON_SECRET",
];

// Execute a shell command with live output
function execLive(command: string): boolean {
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
  });
  return result.status === 0;
}

// Step 1: Build Docker image
function buildImage(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const imageTag = `${IMAGE_BASE}:${timestamp}`;
  const imageLatest = `${IMAGE_BASE}:latest`;

  console.log("\n  Building Docker image...");
  console.log(`  Tag: ${imageTag}\n`);

  const buildArgs = [
    `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=${process.env.BUILD_NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ""}`,
    `NEXT_PUBLIC_FIREBASE_API_KEY=${process.env.NEXT_PUBLIC_FIREBASE_API_KEY || ""}`,
    `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=${process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || ""}`,
    `NEXT_PUBLIC_FIREBASE_PROJECT_ID=${process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || ""}`,
  ]
    .map((arg) => `--build-arg "${arg}"`)
    .join(" ");

  if (!execLive(`docker build ${buildArgs} -t ${imageTag} -t ${imageLatest} .`)) {
    throw new Error("Docker build failed");
  }

  console.log(`\n  Image built: ${imageTag}`);
  return imageTag;
}

// Step 2: Push image to Artifact Registry
function pushImage(imageTag: string): void {
  console.log("\n  Pushing image to Artifact Registry...");

  // Ensure Docker is authenticated
  execLive(`gcloud auth configure-docker ${GCP_REGION}-docker.pkg.dev --quiet`);

  if (!execLive(`docker push ${imageTag}`)) {
    throw new Error("Docker push failed");
  }

  const imageLatest = `${IMAGE_BASE}:latest`;
  if (!execLive(`docker push ${imageLatest}`)) {
    throw new Error("Docker push (latest) failed");
  }

  console.log(`  Image pushed: ${imageTag}`);
}

// Step 3: Deploy to Cloud Run
function deploy(imageTag: string): void {
  console.log("\n  Deploying to Cloud Run...");

  // Build --set-secrets flag: ENV_VAR=SECRET_NAME:latest
  const secretsFlag = SECRET_ENV_VARS.map(
    (key) => `${key}=${key}:latest`
  ).join(",");

  const deployCommand = [
    `gcloud run deploy ${SERVICE_NAME}`,
    `--image=${imageTag}`,
    `--region=${GCP_REGION}`,
    `--project=${GCP_PROJECT}`,
    `--platform=managed`,
    `--port=3000`,
    `--memory=512Mi`,
    `--cpu=1`,
    `--min-instances=0`,
    `--max-instances=3`,
    `--add-cloudsql-instances=${CLOUD_SQL_CONNECTION}`,
    `--set-secrets=${secretsFlag}`,
    `--set-env-vars=NODE_ENV=production,FIREBASE_PROJECT_ID=${FIREBASE_PROJECT}`,
    `--allow-unauthenticated`,
    `--timeout=300`,
  ].join(" ");

  if (!execLive(deployCommand)) {
    throw new Error("Cloud Run deployment failed");
  }

  console.log("  Deployment complete.");
}

// Main
async function main() {
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log("  Pijama Films - Cloud Run Deployment");
  console.log(
    "═══════════════════════════════════════════════════════════════"
  );
  console.log(`\n  Project:  ${GCP_PROJECT}`);
  console.log(`  Region:   ${GCP_REGION}`);
  console.log(`  Service:  ${SERVICE_NAME}`);
  console.log(`  Registry: ${IMAGE_BASE}`);
  console.log(`  Firebase: ${FIREBASE_PROJECT}`);

  // The server writes events with FIREBASE_PROJECT_ID and the browser reads
  // them with NEXT_PUBLIC_FIREBASE_PROJECT_ID. If those disagree, publishing
  // and subscribing hit different databases and events silently never arrive.
  const clientProject = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  if (clientProject && clientProject !== FIREBASE_PROJECT) {
    console.error(
      `\n  Firebase project mismatch:\n` +
        `    server (FIREBASE_PROJECT_ID):             ${FIREBASE_PROJECT}\n` +
        `    client (NEXT_PUBLIC_FIREBASE_PROJECT_ID): ${clientProject}\n\n` +
        `  Events would be published to one database and read from another.\n` +
        `  Set both to the same project before deploying.`
    );
    process.exit(1);
  }

  if (!clientProject) {
    console.error(
      `\n  NEXT_PUBLIC_FIREBASE_PROJECT_ID is not set - the browser could not\n` +
        `  reach Firestore and realtime updates would be dead on arrival.`
    );
    process.exit(1);
  }

  try {
    const imageTag = buildImage();
    pushImage(imageTag);
    deploy(imageTag);

    // Get the service URL
    const serviceUrl = spawnSync(
      `gcloud run services describe ${SERVICE_NAME} --region=${GCP_REGION} --project=${GCP_PROJECT} --format="value(status.url)"`,
      { shell: true, encoding: "utf-8", stdio: "pipe" }
    );

    console.log(
      "\n═══════════════════════════════════════════════════════════════"
    );
    console.log("  Deployment Complete!");
    console.log(
      "═══════════════════════════════════════════════════════════════"
    );
    console.log(`\n  Image:   ${imageTag}`);
    if (serviceUrl.stdout?.trim()) {
      console.log(`  URL:     ${serviceUrl.stdout.trim()}`);
    }
    console.log(
      `  Console: https://console.cloud.google.com/run/detail/${GCP_REGION}/${SERVICE_NAME}/metrics?project=${GCP_PROJECT}`
    );
    console.log("");
  } catch (error) {
    console.error("\n  Deployment failed:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
