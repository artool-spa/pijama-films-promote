#!/usr/bin/env npx tsx
/**
 * Coolify Mercure Deployment Script
 *
 * Provisions a Mercure SSE hub as a Docker image application in Coolify,
 * configures Traefik path-based routing for /.well-known/mercure,
 * and adds Mercure env vars to the existing pijamafilms-app service.
 *
 * Usage: yarn deploy:mercure
 *        yarn deploy:mercure --force-rotate-secret  # Regenerate JWT secret
 *
 * Required environment variables:
 * - COOLIFY_TOKEN: API token from Coolify
 * - COOLIFY_URL: Coolify instance URL (default: https://app.coolify.io)
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env') });

const COOLIFY_URL = process.env.COOLIFY_URL || 'https://app.coolify.io';
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;
const API_BASE = `${COOLIFY_URL}/api/v1`;

const PROJECT_NAME = 'PijamaFilms';
const ENVIRONMENT_NAME = 'production';
const APP_DOMAIN = 'promote.pijamafilms.com';
const MERCURE_SERVICE_NAME = 'pijama-mercure';
const APP_SERVICE_NAME = 'pijamafilms-app';

interface Project {
  uuid: string;
  name: string;
  environments?: Environment[];
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

interface Application {
  uuid: string;
  name: string;
  fqdn?: string;
  status: string;
}

async function coolifyFetch<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;

  let response: Response;
  try {
    response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${COOLIFY_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
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

function generatePassword(length = 48): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let password = '';
  const randomValues = new Uint32Array(length);
  crypto.getRandomValues(randomValues);
  for (let i = 0; i < length; i++) {
    password += chars[randomValues[i] % chars.length];
  }
  return password;
}

async function getProject(): Promise<Project> {
  console.log('\n   Checking Coolify project...');
  const projects = await coolifyFetch<Project[]>('/projects');
  const existing = projects.find((p) => p.name === PROJECT_NAME);
  if (!existing) {
    throw new Error(`Project "${PROJECT_NAME}" not found. Run yarn deploy:coolify first.`);
  }
  console.log(`   Found: ${PROJECT_NAME}`);
  return existing;
}

async function getEnvironment(projectUuid: string): Promise<Environment> {
  const projectData = await coolifyFetch<{ environments: Environment[] }>(
    `/projects/${projectUuid}`
  );
  const existing = projectData.environments?.find((e) => e.name === ENVIRONMENT_NAME);
  if (!existing) {
    throw new Error(`Environment "${ENVIRONMENT_NAME}" not found.`);
  }
  return existing;
}

async function getServer(): Promise<Server> {
  const servers = await coolifyFetch<Server[]>('/servers');
  if (servers.length === 0) {
    throw new Error('No servers available in Coolify');
  }
  return servers[0];
}

async function configureMercureTraefikLabels(appUuid: string): Promise<void> {
  console.log('   Configuring Traefik labels for path-based routing...');

  const labels = [
    'traefik.enable=true',
    `traefik.http.routers.mercure.rule=Host(\`${APP_DOMAIN}\`) && PathPrefix(\`/.well-known/mercure\`)`,
    'traefik.http.routers.mercure.entrypoints=https',
    'traefik.http.routers.mercure.tls=true',
    'traefik.http.routers.mercure.tls.certresolver=letsencrypt',
    'traefik.http.routers.mercure.priority=100',
    'traefik.http.routers.mercure.service=mercure',
    'traefik.http.services.mercure.loadbalancer.server.port=3001',
    `traefik.http.routers.mercure-http.rule=Host(\`${APP_DOMAIN}\`) && PathPrefix(\`/.well-known/mercure\`)`,
    'traefik.http.routers.mercure-http.entrypoints=http',
    'traefik.http.routers.mercure-http.middlewares=redirect-to-https',
    'traefik.http.middlewares.redirect-to-https.redirectscheme.scheme=https',
  ].join('\n');

  await coolifyFetch(`/applications/${appUuid}`, {
    method: 'PATCH',
    body: JSON.stringify({
      custom_labels: Buffer.from(labels).toString('base64'),
    }),
  });
  console.log('   Traefik labels configured');
}

async function setMercureEnvVars(appUuid: string, jwtSecret: string): Promise<void> {
  console.log('   Setting Mercure env vars...');
  const envVars = [
    { key: 'SERVER_NAME', value: ':3001' },
    { key: 'MERCURE_PUBLISHER_JWT_KEY', value: jwtSecret },
    { key: 'MERCURE_SUBSCRIBER_JWT_KEY', value: jwtSecret },
    { key: 'MERCURE_EXTRA_DIRECTIVES', value: `anonymous\ncors_origins https://${APP_DOMAIN}` },
  ];

  for (const env of envVars) {
    await coolifyFetch(`/applications/${appUuid}/envs`, {
      method: 'POST',
      body: JSON.stringify(env),
    });
  }
  console.log('   Env vars configured');
}

async function getOrCreateMercureApp(
  serverUuid: string,
  projectUuid: string,
  environmentName: string
): Promise<{ app: Application; isNew: boolean }> {
  console.log('\n   Checking Mercure application...');

  const applications = await coolifyFetch<Application[]>('/applications');
  const existing = applications.find((app) => app.name === MERCURE_SERVICE_NAME);

  if (existing) {
    console.log(`   Found: ${MERCURE_SERVICE_NAME} (${existing.uuid})`);
    await configureMercureTraefikLabels(existing.uuid);
    return { app: existing, isNew: false };
  }

  console.log(`   Creating: ${MERCURE_SERVICE_NAME}`);

  const newApp = await coolifyFetch<Application>('/applications/dockerimage', {
    method: 'POST',
    body: JSON.stringify({
      server_uuid: serverUuid,
      project_uuid: projectUuid,
      environment_name: environmentName,
      name: MERCURE_SERVICE_NAME,
      description: 'Mercure SSE Hub for real-time events',
      docker_registry_image_name: 'dunglas/mercure',
      docker_registry_image_tag: 'latest',
      ports_exposes: '3001',
      instant_deploy: false,
    }),
  });

  console.log(`   Created: ${MERCURE_SERVICE_NAME} (${newApp.uuid})`);

  await configureMercureTraefikLabels(newApp.uuid);

  return { app: newApp, isNew: true };
}

async function addMercureEnvToApp(jwtSecret: string): Promise<void> {
  console.log('\n   Adding Mercure env vars to app service...');

  const applications = await coolifyFetch<Application[]>('/applications');
  const app = applications.find((a) => a.name === APP_SERVICE_NAME);

  if (!app) {
    console.warn(`   Warning: ${APP_SERVICE_NAME} not found. Add Mercure env vars manually.`);
    return;
  }

  const envVars = [
    { key: 'MERCURE_URL', value: `http://${MERCURE_SERVICE_NAME}:3001/.well-known/mercure` },
    { key: 'NEXT_PUBLIC_MERCURE_URL', value: `https://${APP_DOMAIN}/.well-known/mercure` },
    { key: 'MERCURE_JWT_SECRET', value: jwtSecret },
  ];

  for (const env of envVars) {
    try {
      await coolifyFetch(`/applications/${app.uuid}/envs`, {
        method: 'POST',
        body: JSON.stringify(env),
      });
    } catch (error) {
      // Env var might already exist
      console.warn(`   Warning: Could not set ${env.key}: ${error instanceof Error ? error.message : error}`);
    }
  }

  console.log(`   Mercure env vars added to ${APP_SERVICE_NAME}`);
}

async function triggerDeployment(appUuid: string): Promise<void> {
  console.log('\n   Triggering Mercure deployment...');
  const response = await coolifyFetch<{ message: string; deployment_uuid: string }>(
    `/applications/${appUuid}/start`,
    { method: 'POST' }
  );
  console.log(`   Deployment queued: ${response.deployment_uuid}`);
}

async function main() {
  console.log('===================================================================');
  console.log('  Pijama Films - Mercure SSE Hub Deployment');
  console.log('===================================================================');

  if (!COOLIFY_TOKEN) {
    console.error('\n   COOLIFY_TOKEN is required');
    process.exit(1);
  }

  try {
    const project = await getProject();
    const environment = await getEnvironment(project.uuid);
    const server = await getServer();

    const { app: mercureApp, isNew } = await getOrCreateMercureApp(
      server.uuid,
      project.uuid,
      environment.name
    );

    const forceRotate = process.argv.includes('--force-rotate-secret');

    if (isNew || forceRotate) {
      const jwtSecret = generatePassword(48);
      console.log(`\n   Generated JWT secret for Mercure`);
      await setMercureEnvVars(mercureApp.uuid, jwtSecret);
      await addMercureEnvToApp(jwtSecret);
    } else {
      console.log('\n   Existing app — skipping JWT secret generation');
      console.log('   (use --force-rotate-secret to regenerate)');
    }

    await triggerDeployment(mercureApp.uuid);

    console.log('\n===================================================================');
    console.log('  Mercure Deployment Triggered!');
    console.log('===================================================================');
    console.log(`\n   Service:  ${MERCURE_SERVICE_NAME}`);
    console.log(`   Route:    https://${APP_DOMAIN}/.well-known/mercure`);
    console.log(`   Monitor:  ${COOLIFY_URL}`);
    console.log('');
  } catch (error) {
    console.error('\n   Deployment failed:');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
