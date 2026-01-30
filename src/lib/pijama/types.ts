import { z } from 'zod';

// ============================================================================
// CONFIGURATION
// ============================================================================

export const PijamaConfigSchema = z.object({
  baseUrl: z.string().url().default('https://api.pijamafilms.com'),
  clientId: z.string().min(1, 'PIJAMA_CLIENT_ID is required'),
  clientSecret: z.string().min(1, 'PIJAMA_CLIENT_SECRET is required'),
});

export type PijamaConfig = z.infer<typeof PijamaConfigSchema>;

// ============================================================================
// AUTH RESPONSES
// ============================================================================

export const PijamaTokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string().default('Bearer'),
  expires_in: z.number(), // seconds
  refresh_token: z.string().optional(),
});

export type PijamaTokenResponse = z.infer<typeof PijamaTokenResponseSchema>;

// ============================================================================
// PARTNER DATA
// ============================================================================

export const PijamaPartnerSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().email(),
  company: z.string().optional(),
  phone: z.string().optional(),
  country: z.string().optional(),
  status: z.enum(['active', 'inactive', 'pending']).default('active'),
  created_at: z.string().optional(),
  updated_at: z.string().optional(),
  // Film access
  film_ids: z.array(z.string()).default([]), // MUVI film UUIDs this partner can access
});

export type PijamaPartner = z.infer<typeof PijamaPartnerSchema>;

export const PijamaPartnerListResponseSchema = z.object({
  data: z.array(PijamaPartnerSchema),
  total: z.number(),
  page: z.number(),
  per_page: z.number(),
});

export type PijamaPartnerListResponse = z.infer<typeof PijamaPartnerListResponseSchema>;

// ============================================================================
// API ERROR RESPONSE
// ============================================================================

export const PijamaErrorResponseSchema = z.object({
  error: z.string(),
  error_description: z.string().optional(),
  error_code: z.string().optional(),
});

export type PijamaErrorResponse = z.infer<typeof PijamaErrorResponseSchema>;
