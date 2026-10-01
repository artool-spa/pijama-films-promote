/**
 * Which identity the triggers run as, per project.
 *
 * This is not cosmetic. The backend authorizes every internal call by verifying
 * a Google-signed OIDC token and checking the service account that signed it
 * against CRON_INVOKER_SERVICE_ACCOUNTS in that project's apphosting.yaml. The
 * two values are a pair: if they disagree, every scheduled job and every queued
 * task gets a 401, the function logs only "responded 401", and the backend logs
 * show a rejected caller with no hint of which one was expected.
 *
 * It is resolved from the project rather than hardcoded because the default
 * compute service account carries the PROJECT NUMBER, which differs per
 * project — so a single literal is correct in exactly one environment and
 * silently wrong in every other.
 */

/**
 * Project id → the service account its triggers run as.
 *
 * Add an entry before deploying to a new project. An explicit map is preferred
 * over deriving the address from the project number, which would require an API
 * call at discovery time and would make the pairing with apphosting.yaml
 * impossible to check by reading.
 */
const SERVICE_ACCOUNTS: Record<string, string> = {
  'pijama-promote-firebase': '603164121416-compute@developer.gserviceaccount.com',
};

/**
 * Resolve the service account for a project id.
 *
 * Throws on an unknown project instead of falling back to anything. A fallback
 * here would be a fallback to *another environment's* identity, which is the
 * precise mistake this module exists to prevent — and the failure it would
 * cause (401s on every trigger) gives no clue about its own cause.
 *
 * Deliberately not tolerant at runtime: `GOOGLE_CLOUD_PROJECT` is guaranteed by
 * the Cloud Functions runtime, and a deployed function is always running in a
 * project that was in this map when it was deployed. So this throwing can only
 * fire during discovery, which is exactly where a missing entry must be caught.
 */
export function resolveServiceAccount(projectId: string | undefined): string {
  if (!projectId) {
    throw new Error(
      'Cannot resolve the trigger service account: no project id in the ' +
        'environment (GOOGLE_CLOUD_PROJECT / GCLOUD_PROJECT). Deploy with ' +
        '`firebase deploy --only functions --project <id>`.'
    );
  }

  const serviceAccount = SERVICE_ACCOUNTS[projectId];
  if (!serviceAccount) {
    const known = Object.keys(SERVICE_ACCOUNTS).join(', ') || '(none)';
    throw new Error(
      `No trigger service account configured for project "${projectId}". ` +
        `Known projects: ${known}. Add it to SERVICE_ACCOUNTS in ` +
        'functions/src/service-account.ts, and make sure the same address is ' +
        "listed in that project's CRON_INVOKER_SERVICE_ACCOUNTS."
    );
  }

  return serviceAccount;
}

/** The project the CLI or the runtime says we are in. */
export function currentProjectId(): string | undefined {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT;
}
