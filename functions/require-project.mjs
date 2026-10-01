#!/usr/bin/env node
/**
 * Refuse to deploy functions without an explicit project.
 *
 * These scripts used to hardcode `--project=pijama-promote-firebase`. With one
 * environment that was merely redundant; with two it is a loaded gun, because
 * `npm run deploy` from a development checkout would publish straight to
 * production and say nothing about it.
 *
 * Deliberately no default. `scripts/firestore-setup.sh` carries the same rule
 * and the incident that justifies it: a default project is not a convenience,
 * it is a guess about which environment you meant, made at the moment you are
 * least likely to check.
 */

const projectId = process.env.FIREBASE_PROJECT_ID;

if (!projectId) {
  process.stderr.write(
    `error: no project given.

Set FIREBASE_PROJECT_ID explicitly — this deploys Cloud Functions, so it will
not guess which project to touch.

  FIREBASE_PROJECT_ID=pijama-promote-firebase npm run deploy

Note that this does not read .env; export the variable in the shell.
`
  );
  process.exit(1);
}

process.stdout.write(`==> Project: ${projectId}\n`);
