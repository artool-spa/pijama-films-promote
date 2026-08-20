/**
 * Whether an `ads/{adId}` write means the campaign is newly ready to sync.
 *
 * Kept free of any firebase imports so it can be unit tested from the app's
 * vitest suite without pulling the functions runtime in.
 */
export function becameAssetReady(
  before: { imageIds?: unknown } | undefined,
  after: { imageIds?: unknown } | undefined
): boolean {
  if (!after) return false;

  const count = (doc: { imageIds?: unknown } | undefined): number =>
    Array.isArray(doc?.imageIds) ? doc.imageIds.length : 0;

  // Only the empty -> non-empty transition is a signal. An ad that already had
  // images and was edited again must not re-enqueue, or every later write to a
  // synced campaign would dispatch another task.
  return count(before) === 0 && count(after) > 0;
}
