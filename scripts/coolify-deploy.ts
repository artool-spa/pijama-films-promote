#!/usr/bin/env npx tsx
/**
 * Coolify Deployment Script
 *
 * Builds the Docker image locally, pushes to GitHub Container Registry,
 * and deploys to Coolify using the pre-built image.
 *
 * Usage: yarn deploy:coolify
 *
 * Required environment variables:
 * - COOLIFY_TOKEN: API token from Coolify
 * - GITHUB_TOKEN: GitHub token with packages:write permission
 * - COOLIFY_URL: Coolify instance URL (default: https://app.coolify.io)
 */

import { config } from "dotenv";
import { resolve } from "path";
import { execSync, spawnSync } from "child_process";

// Load environment variables from .env
config({ path: resolve(process.cwd(), ".env") });

// Configuration
const COOLIFY_URL = process.env.COOLIFY_URL || "https://app.coolify.io";
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const API_BASE = `${COOLIFY_URL}/api/v1`;

const PROJECT_NAME = "PijamaFilms";
const ENVIRONMENT_NAME = "production";
const GITHUB_REPO = "paparga/pijama-films";
const IMAGE_NAME = `ghcr.io/${GITHUB_REPO.toLowerCase()}`;
const APP_DOMAIN = "https://promote.pijamafilms.com";

// Database configuration
const DB_NAME = "pijama_films";
const DB_USER = "pijama";
const DB_SERVICE_NAME = "pijamafilms-postgres";
const APP_SERVICE_NAME = "pijamafilms-app";

interface Project {
  uuid: string;
  name: string;
  description?: string;
}

interface Environment {
  id: number;
  uuid: string;
  name: string;
  project_uuid: string;
}

interface Server {
  uuid: string;
  name: string;
  ip: string;
}

interface Database {
  uuid: string;
  name: string;
  type: string;
  status: string;
}

interface Application {
  uuid: string;
  name: string;
  fqdn?: string;
  status: string;
}

// Execute a shell command with live output
function execLive(command: string): boolean {
  const result = spawnSync(command, {
    shell: true,
    stdio: "inherit",
  });
  return result.status === 0;
}

// Execute a shell command and return output
function exec(command: string, options: { silent?: boolean } = {}): string {
  const output = execSync(command, {
    encoding: "utf-8",
    stdio: options.silent ? "pipe" : "inherit",
  });
  return output?.trim() || "";
}

// Utility function for API calls
async function coolifyFetch<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${COOLIFY_TOKEN}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...options.headers,
      },
    });
  } catch (error) {
    const err = error as Error;
    throw new Error(`Network error: ${err.message}`);
  }

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error ${response.status}: ${errorText}`);
  }

  const text = await response.text();
  if (!text) return {} as T;
  return JSON.parse(text) as T;
}

// Generate a secure random password
function generatePassword(length = 32): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let password = "";
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    password += chars[randomValues[i] % chars.length];
  }
  return password;
}

// Step 1: Build and push Docker image
function buildAndPushImage(): string {
  const imageTag = `${IMAGE_NAME}:latest`;

  console.log("\n🔨 Building Docker image...");
  console.log(`   Tag: ${imageTag}\n`);

  if (!execLive(`docker build -t ${imageTag} .`)) {
    throw new Error("Docker build failed");
  }

  console.log("\n📦 Logging into GitHub Container Registry...");
  if (!execLive(`echo "${GITHUB_TOKEN}" | docker login ghcr.io -u paparga --password-stdin`)) {
    throw new Error("Docker login failed");
  }

  console.log("\n📤 Pushing image to ghcr.io...");
  if (!execLive(`docker push ${imageTag}`)) {
    throw new Error("Docker push failed");
  }

  console.log(`   ✓ Image pushed: ${imageTag}`);
  return imageTag;
}

// Step 2: Push code to GitHub
function pushToGitHub(): void {
  console.log("\n📤 Pushing to GitHub...");

  // Check for uncommitted changes
  try {
    const status = exec("git status --porcelain", { silent: true });
    if (status) {
      console.log("   Uncommitted changes found, committing...");
      execLive('git add -A && git commit -m "Deploy to production"');
    }
  } catch {
    // Ignore
  }

  if (!execLive("git push origin master")) {
    throw new Error("Git push failed");
  }
  console.log("   ✓ Pushed to GitHub");
}

// Step 3: Get or create Coolify project
async function getOrCreateProject(): Promise<Project> {
  console.log("\n📁 Checking Coolify project...");

  const projects = await coolifyFetch<Project[]>("/projects");
  const existing = projects.find((p) => p.name === PROJECT_NAME);

  if (existing) {
    console.log(`   ✓ Found: ${PROJECT_NAME}`);
    return existing;
  }

  console.log(`   Creating: ${PROJECT_NAME}`);
  const newProject = await coolifyFetch<Project>("/projects", {
    method: "POST",
    body: JSON.stringify({
      name: PROJECT_NAME,
      description: "Pijama Films - Indie film streaming promotion platform",
    }),
  });
  console.log(`   ✓ Created: ${PROJECT_NAME}`);
  return newProject;
}

// Step 4: Get or create environment
async function getOrCreateEnvironment(projectUuid: string): Promise<Environment> {
  console.log("\n🌍 Checking environment...");

  const projectData = await coolifyFetch<{ environments: Environment[] }>(
    `/projects/${projectUuid}`
  );

  const existing = projectData.environments?.find((e) => e.name === ENVIRONMENT_NAME);

  if (existing) {
    console.log(`   ✓ Found: ${ENVIRONMENT_NAME}`);
    return existing;
  }

  console.log(`   Creating: ${ENVIRONMENT_NAME}`);
  const newEnv = await coolifyFetch<Environment>("/environments", {
    method: "POST",
    body: JSON.stringify({
      name: ENVIRONMENT_NAME,
      project_uuid: projectUuid,
    }),
  });
  console.log(`   ✓ Created: ${ENVIRONMENT_NAME}`);
  return newEnv;
}

// Step 5: Get server
async function getServer(): Promise<Server> {
  console.log("\n🖥️  Getting server...");

  const servers = await coolifyFetch<Server[]>("/servers");
  if (servers.length === 0) {
    throw new Error("No servers available in Coolify");
  }

  const server = servers[0];
  console.log(`   ✓ Using: ${server.name}`);
  return server;
}

// Step 6: Get or create database
async function getOrCreateDatabase(
  serverUuid: string,
  projectUuid: string,
  environmentName: string
): Promise<{ database: Database; connectionString: string }> {
  console.log("\n🗄️  Checking database...");

  const databases = await coolifyFetch<Database[]>("/databases");
  // Use exact name match (type is null in list response, so we only check name)
  const existing = databases.find((db) => db.name === DB_SERVICE_NAME);

  if (existing) {
    console.log(`   ✓ Found: ${existing.name} (${existing.uuid})`);

    const details = await coolifyFetch<{
      internal_db_url?: string;
      postgres_user?: string;
      postgres_password?: string;
      postgres_db?: string;
    }>(`/databases/${existing.uuid}`);

    const connectionString =
      details.internal_db_url ||
      `postgresql://${details.postgres_user}:${details.postgres_password}@${existing.uuid}:5432/${details.postgres_db}`;

    return { database: existing, connectionString };
  }

  console.log(`   Creating PostgreSQL database: ${DB_SERVICE_NAME}`);
  const dbPassword = generatePassword();

  const newDb = await coolifyFetch<Database>("/databases/postgresql", {
    method: "POST",
    body: JSON.stringify({
      server_uuid: serverUuid,
      project_uuid: projectUuid,
      environment_name: environmentName,
      name: DB_SERVICE_NAME,
      postgres_user: DB_USER,
      postgres_password: dbPassword,
      postgres_db: DB_NAME,
      is_public: false,
      instant_deploy: true,
    }),
  });

  console.log(`   ✓ Created database: ${DB_SERVICE_NAME} (${newDb.uuid})`);
  console.log(`   ⚠️  Password: ${dbPassword} (save this!)`);

  const connectionString = `postgresql://${DB_USER}:${dbPassword}@${newDb.uuid}:5432/${DB_NAME}`;
  return { database: newDb, connectionString };
}

// Step 7: Get or create application (using Docker image)
async function getOrCreateApplication(
  serverUuid: string,
  projectUuid: string,
  environmentName: string,
  databaseConnectionString: string,
  imageTag: string
): Promise<Application> {
  console.log("\n🚀 Checking application...");

  const applications = await coolifyFetch<Application[]>("/applications");
  // Use exact name match
  const existing = applications.find((app) => app.name === APP_SERVICE_NAME);

  if (existing) {
    console.log(`   ✓ Found: ${existing.name} (${existing.uuid})`);

    // Update the image tag
    console.log("   Updating image tag...");
    await coolifyFetch(`/applications/${existing.uuid}`, {
      method: "PATCH",
      body: JSON.stringify({
        docker_registry_image_name: imageTag.split(":")[0],
        docker_registry_image_tag: imageTag.split(":")[1] || "master",
      }),
    });
    console.log(`   ✓ Updated to: ${imageTag}`);

    return existing;
  }

  console.log(`   Creating application: ${APP_SERVICE_NAME}`);

  const newApp = await coolifyFetch<Application>("/applications/dockerimage", {
    method: "POST",
    body: JSON.stringify({
      server_uuid: serverUuid,
      project_uuid: projectUuid,
      environment_name: environmentName,
      name: APP_SERVICE_NAME,
      description: "Pijama Films Next.js Application",
      docker_registry_image_name: imageTag.split(":")[0],
      docker_registry_image_tag: imageTag.split(":")[1] || "master",
      ports_exposes: "3000",
      domains: APP_DOMAIN,
      instant_deploy: false,
    }),
  });

  console.log(`   ✓ Created application: ${APP_SERVICE_NAME} (${newApp.uuid})`);

  // Configure environment variables
  console.log("   Setting environment variables...");

  const envVars = [
    { key: "DATABASE_URL", value: databaseConnectionString },
    { key: "NODE_ENV", value: "production" },
    { key: "JWT_SECRET_KEY", value: generatePassword(48) },
    { key: "JWT_EXPIRATION_TIME", value: "7d" },
  ];

  for (const env of envVars) {
    await coolifyFetch(`/applications/${newApp.uuid}/envs`, {
      method: "POST",
      body: JSON.stringify(env),
    });
  }

  console.log("   ✓ Environment variables configured");
  return newApp;
}

// Step 8: Trigger deployment
async function triggerDeployment(appUuid: string): Promise<void> {
  console.log("\n🚀 Triggering deployment...");

  const response = await coolifyFetch<{ message: string; deployment_uuid: string }>(
    `/applications/${appUuid}/start`,
    { method: "POST" }
  );

  console.log(`   ✓ Deployment queued: ${response.deployment_uuid}`);
}

// Main
async function main() {
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Pijama Films - Production Deployment");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log(`\nImage Registry: ghcr.io`);
  console.log(`Domain: ${APP_DOMAIN}`);

  if (!COOLIFY_TOKEN) {
    console.error("\n❌ COOLIFY_TOKEN is required");
    process.exit(1);
  }
  if (!GITHUB_TOKEN) {
    console.error("\n❌ GITHUB_TOKEN is required (with packages:write permission)");
    process.exit(1);
  }

  try {
    // Build and push image
    const imageTag = buildAndPushImage();

    // Push code to GitHub
    pushToGitHub();

    // Setup Coolify resources
    const project = await getOrCreateProject();
    const environment = await getOrCreateEnvironment(project.uuid);
    const server = await getServer();
    const { database, connectionString } = await getOrCreateDatabase(
      server.uuid,
      project.uuid,
      environment.name
    );
    const application = await getOrCreateApplication(
      server.uuid,
      project.uuid,
      environment.name,
      connectionString,
      imageTag
    );

    // Deploy
    await triggerDeployment(application.uuid);

    console.log("\n═══════════════════════════════════════════════════════════════");
    console.log("  Deployment Triggered!");
    console.log("═══════════════════════════════════════════════════════════════");
    console.log(`\n   Image:    ${imageTag}`);
    console.log(`   Domain:   ${APP_DOMAIN}`);
    console.log(`   Monitor:  ${COOLIFY_URL}`);
    console.log("");
  } catch (error) {
    console.error("\n❌ Deployment failed:");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
