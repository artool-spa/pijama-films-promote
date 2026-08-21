/**
 * Render the `details` of a 400 from our own Zod validation.
 *
 * The create-and-sync routes answer `{ error: 'Invalid campaign data', details:
 * result.error.flatten() }`, but the client used to show only `error`. Since
 * that string is a constant, a validation failure reached the producer as an
 * unexplained "Invalid campaign data" while the offending field sat unread in
 * the same response.
 *
 * Kept free of imports so both the routes and client components can use it.
 */

export type ZodFlattenedError = {
  formErrors?: string[];
  fieldErrors?: Record<string, Array<string> | undefined>;
};

export type ApiErrorBody = {
  error?: string;
  details?: ZodFlattenedError | string | unknown;
};

/**
 * One line naming the fields that failed, or null when the body carries no
 * usable Zod details (a platform error, say, whose `details` is a string).
 */
export function formatValidationDetails(body: ApiErrorBody | null | undefined): string | null {
  const details = body?.details;
  if (!details || typeof details !== 'object') return null;

  const { fieldErrors, formErrors } = details as ZodFlattenedError;

  const parts: string[] = [];
  for (const [field, messages] of Object.entries(fieldErrors ?? {})) {
    const text = (messages ?? []).filter(Boolean).join(', ');
    parts.push(text ? `${field}: ${text}` : field);
  }
  parts.push(...(formErrors ?? []).filter(Boolean));

  return parts.length > 0 ? parts.join(' | ') : null;
}

/**
 * The message to show for a failed request: the API's own message, with the
 * validation detail appended when there is one.
 */
export function describeApiError(body: ApiErrorBody | null | undefined, fallback: string): string {
  const detail = formatValidationDetails(body);
  const base = body?.error || fallback;
  return detail ? `${base} (${detail})` : base;
}
