/**
 * Asset validation status, shared by images and videos.
 *
 * Replaces the `AssetStatus` enum Prisma used to generate. It lives in its own
 * module, free of server-only imports, so client components and the model layer
 * can both use it.
 */

import { z } from 'zod';

export const AssetStatusSchema = z.enum([
  'PENDING', // Awaiting validation
  'VALIDATING', // Validation in progress
  'READY', // Valid and ready
  'INVALID', // Does not meet requirements
  'ERROR', // System error
]);

export type AssetStatus = z.infer<typeof AssetStatusSchema>;
