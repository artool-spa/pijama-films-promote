import { z } from 'zod';

// Configuration schema (credentials for get-user-token-details)
export const MuviConfigSchema = z.object({
  secretKey: z.string().min(1, 'MUVI_SECRET_KEY is required'),
  appId: z.string().min(1, 'MUVI_APP_ID is required'),
  baseUrl: z.string().url().default('https://apigateway.muvi.com'),
});

export type MuviConfig = z.infer<typeof MuviConfigSchema>;

// Token response schema (get-user-token-details endpoint)
// The actual API returns more data than documented
export const MuviTokenResponseSchema = z.object({
  code: z.number(),
  status: z.string(),
  message: z.string(),
  response: z.object({
    access_token: z.string(),
    refresh_token: z.string(),
  }),
  data: z.object({
    product_key: z.string(),
    app_token: z.string(),
    store_key: z.string().optional(),
    user_uuid: z.string().optional(),
    product_name: z.string().optional(),
    product_code: z.string().optional(),
    cms_url: z.string().optional(),
  }),
});

export type MuviTokenResponse = z.infer<typeof MuviTokenResponseSchema>;

// Image asset schema
export const MuviImageAssetSchema = z.object({
  file_uuid: z.string().optional(),
  file_name: z.string().optional(),
  file_url: z.string().optional(),
  image_uuid: z.string().optional(),
});

export type MuviImageAsset = z.infer<typeof MuviImageAssetSchema>;

// Resolution details schema
export const MuviResolutionSchema = z.object({
  resolution: z.string().optional(),
  url: z.string().optional(),
});

export type MuviResolution = z.infer<typeof MuviResolutionSchema>;

// Video asset schema
// Note: duration can be number or string (e.g., "01:44:04")
export const MuviVideoAssetSchema = z.object({
  video_uuid: z.string().nullable().optional(),
  file_name: z.string().nullable().optional(),
  file_url: z.string().nullable().optional(),
  is_feed: z.union([z.boolean(), z.number()]).nullable().optional(),
  is_drm: z.union([z.boolean(), z.number()]).nullable().optional(),
  encoding_status: z.string().nullable().optional(),
  duration: z.union([z.number(), z.string()]).nullable().optional(),
  stream_type: z.string().nullable().optional(),
  stream_format: z.string().nullable().optional(),
  hls_path: z.string().nullable().optional(),
  mpeg_path: z.string().nullable().optional(),
  third_party_url: z.string().nullable().optional(),
  resolution_details: z.array(MuviResolutionSchema).nullable().optional(),
  encoded_url: z.array(MuviResolutionSchema).nullable().optional(),
  offline_url: z.array(MuviResolutionSchema).nullable().optional(),
});

export type MuviVideoAsset = z.infer<typeof MuviVideoAssetSchema>;

// Cast details schema
export const MuviCastSchema = z.object({
  cast_uuid: z.string().optional(),
  cast_name: z.string().optional(),
  cast_bio: z.string().optional(),
  cast_image_uuid: z.string().optional(),
  cast_image_details: MuviImageAssetSchema.optional(),
  cast_type_details: z.object({
    cast_type_uuid: z.string().optional(),
    cast_type_name: z.string().optional(),
  }).optional(),
});

export type MuviCast = z.infer<typeof MuviCastSchema>;

// Category schema
// Note: Fields can be null from the API
export const MuviCategorySchema = z.object({
  category_uuid: z.string().nullable().optional(),
  category_name: z.string().nullable().optional(),
  category_parent_uuid: z.string().nullable().optional(),
  category_permalink: z.string().nullable().optional(),
  category_image_uuid: z.string().nullable().optional(),
  created_date: z.string().nullable().optional(),
});

export type MuviCategory = z.infer<typeof MuviCategorySchema>;

// Posters/Banners schema
// Note: The API returns arrays for each platform (e.g., website: [...])
// Arrays can be null when no images are uploaded
export const MuviMediaImagesSchema = z.object({
  website: z.array(MuviImageAssetSchema).nullable().optional(),
  tv_apps: z.array(MuviImageAssetSchema).nullable().optional(),
  mobile_apps: z.array(MuviImageAssetSchema).nullable().optional(),
});

export type MuviMediaImages = z.infer<typeof MuviMediaImagesSchema>;

// Movie (content) schema
// Note: Many fields can be null, numbers, or strings depending on API state
export const MuviMovieSchema = z.object({
  content_uuid: z.string(),
  content_id: z.string().nullable().optional(),
  content_name: z.string(),
  content_desc: z.string().nullable().optional(),
  content_permalink: z.string().nullable().optional(),
  content_search_tag: z.string().nullable().optional(),
  content_category_uuid: z.string().nullable().optional(),
  content_sub_category_uuid: z.string().nullable().optional(),
  content_template_uuid: z.string().nullable().optional(),
  content_parent_uuid: z.string().nullable().optional(),
  // content_asset_type can be number (1=Video, 2=Audio) or string
  content_asset_type: z.union([z.string(), z.number()]).nullable().optional(),
  content_poster_uuid: z.string().nullable().optional(),
  content_banner_uuid: z.string().nullable().optional(),
  content_accessibility: z.string().nullable().optional(),
  content_created_date: z.string().nullable().optional(),
  content_updated_date: z.string().nullable().optional(),
  // User UUIDs for content ownership tracking
  content_created_by: z.string().nullable().optional(),
  content_updated_by: z.string().nullable().optional(),
  // content_status can be number or string
  content_status: z.union([z.string(), z.number()]).nullable().optional(),
  // is_encoded can be 0/1 (number) or boolean
  is_encoded: z.union([z.boolean(), z.number()]).nullable().optional(),
  is_free_content: z.boolean().nullable().optional(),
  // is_parent can be 0/1 (number) or boolean
  is_parent: z.union([z.boolean(), z.number()]).nullable().optional(),
  no_of_child_content: z.number().nullable().optional(),
  maturity_rating: z.string().nullable().optional(),
  serial_number: z.number().nullable().optional(),
  categories: z.array(MuviCategorySchema).nullable().optional(),
  posters: MuviMediaImagesSchema.nullable().optional(),
  banners: MuviMediaImagesSchema.nullable().optional(),
  app_poster_details: MuviImageAssetSchema.nullable().optional(),
  no_image_available_url: z.string().nullable().optional(),
});

export type MuviMovie = z.infer<typeof MuviMovieSchema>;

// Movie details (full content with assets)
// Note: tags can be string or array, like_status can be boolean or number
export const MuviMovieDetailsSchema = MuviMovieSchema.extend({
  video_details: MuviVideoAssetSchema.nullable().optional(),
  trailer_details: MuviVideoAssetSchema.nullable().optional(),
  audio_details: MuviVideoAssetSchema.nullable().optional(),
  cast_details: z.array(MuviCastSchema).nullable().optional(),
  // tags can be a comma-separated string or an array
  tags: z.union([z.string(), z.array(z.string())]).nullable().optional(),
  like_status: z.union([z.boolean(), z.number()]).nullable().optional(),
  total_likes_count: z.number().nullable().optional(),
  avg_rating: z.number().nullable().optional(),
  child_content: z.array(MuviMovieSchema).nullable().optional(),
});

export type MuviMovieDetails = z.infer<typeof MuviMovieDetailsSchema>;

// Page info schema
export const MuviPageInfoSchema = z.object({
  total_count: z.number(),
});

export type MuviPageInfo = z.infer<typeof MuviPageInfoSchema>;

// Content list response schema
// The actual API response includes code, status, message at the root level
export const MuviContentListResponseSchema = z.object({
  code: z.number(),
  status: z.string(),
  message: z.string().optional(),
  data: z.object({
    contentList: z.object({
      page_info: MuviPageInfoSchema.optional(),
      content_list: z.array(MuviMovieDetailsSchema),
    }),
  }),
});

export type MuviContentListResponse = z.infer<typeof MuviContentListResponseSchema>;

// API response wrapper
export const MuviApiResponseSchema = z.object({
  code: z.number(),
  status: z.string(),
  message: z.string().optional(),
});

export type MuviApiResponse = z.infer<typeof MuviApiResponseSchema>;

// Options for getMovies
export interface GetMoviesOptions {
  page?: number;
  perPage?: number;
  userUuid?: string;
  contentAssetType?: '1' | '2'; // 1=Video, 2=Audio
  sortBy?: 'atoz' | 'ztoa' | 'otn' | 'nto';
  contentName?: string;
  categoryUuid?: string;
}

// Result types for API functions
export interface GetMoviesResult {
  movies: MuviMovie[];
  totalCount: number;
  page: number;
  perPage: number;
}
