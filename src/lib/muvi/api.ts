import logger from '@/lib/logger';
import { MuviTokenHandler } from './client';
import {
  MuviMovie,
  MuviMovieDetails,
  MuviContentListResponseSchema,
  MuviContentListEnvelopeSchema,
  GetMoviesOptions,
  GetMoviesResult,
} from './types';
import { MuviApiError, MuviValidationError } from './errors';

// IP address required for geo-block enabled accounts
const MUVI_IP_ADDRESS = process.env.MUVI_IP_ADDRESS || '127.0.0.1';

// GraphQL query for basic movie list
const MOVIES_LIST_QUERY = `
  contentList(
    app_token: ":app_token",
    product_key: ":product_key",
    ip_address: ":ip_address"
    {{FILTERS}}
  ) {
    page_info {
      total_count
    }
    content_list {
      content_uuid
      content_id
      content_name
      content_desc
      content_permalink
      content_search_tag
      content_category_uuid
      content_sub_category_uuid
      content_template_uuid
      content_parent_uuid
      content_asset_type
      content_poster_uuid
      content_banner_uuid
      content_accessibility
      content_created_date
      content_updated_date
      content_created_by
      content_updated_by
      content_status
      is_encoded
      is_free_content
      is_parent
      no_of_child_content
      maturity_rating
      serial_number
      categories {
        category_uuid
        category_name
        category_permalink
      }
      posters {
        website { file_uuid file_name file_url }
        tv_apps { file_uuid file_name file_url }
        mobile_apps { file_uuid file_name file_url }
      }
      banners {
        website { file_uuid file_name file_url }
        tv_apps { file_uuid file_name file_url }
        mobile_apps { file_uuid file_name file_url }
      }
      app_poster_details { image_uuid file_name file_url }
      no_image_available_url
      custom_field_data { custom_field_name custom_field_value }
    }
  }
`;

// GraphQL query for movie details with assets
const MOVIE_DETAILS_QUERY = `
  contentList(
    app_token: ":app_token",
    product_key: ":product_key",
    ip_address: ":ip_address",
    content_uuid: ":content_uuid"
  ) {
    page_info {
      total_count
    }
    content_list {
      content_uuid
      content_id
      content_name
      content_desc
      content_permalink
      content_search_tag
      content_category_uuid
      content_sub_category_uuid
      content_template_uuid
      content_parent_uuid
      content_asset_type
      content_poster_uuid
      content_banner_uuid
      content_accessibility
      content_created_date
      content_updated_date
      content_created_by
      content_updated_by
      content_status
      is_encoded
      is_free_content
      is_parent
      no_of_child_content
      maturity_rating
      serial_number
      categories {
        category_uuid
        category_name
        category_permalink
        category_parent_uuid
        category_image_uuid
        created_date
        sub_category {
          category_uuid
          category_name
          category_permalink
        }
      }
      posters {
        website { file_uuid file_name file_url }
        tv_apps { file_uuid file_name file_url }
        mobile_apps { file_uuid file_name file_url }
      }
      banners {
        website { file_uuid file_name file_url }
        tv_apps { file_uuid file_name file_url }
        mobile_apps { file_uuid file_name file_url }
      }
      app_poster_details { image_uuid file_name file_url }
      no_image_available_url
      custom_field_data { custom_field_name custom_field_value }
      video_details {
        video_uuid
        file_name
        file_url
        is_feed
        is_drm
        encoding_status
        duration
        stream_type
        stream_format
        hls_path
        mpeg_path
        third_party_url
        resolution_details { resolution url }
        encoded_url { resolution url }
        offline_url { resolution url }
      }
      trailer_details {
        video_uuid
        file_name
        file_url
        is_feed
        is_drm
        encoding_status
        duration
        stream_type
        stream_format
        hls_path
        mpeg_path
        third_party_url
        resolution_details { resolution url }
        encoded_url { resolution url }
      }
      audio_details {
        audio_uuid
        file_name
        file_url
        is_feed
        is_drm
        encoding_status
        duration
        stream_type
        stream_format
        hls_path
        resolution_details { resolution url }
        encoded_url { resolution url }
      }
      cast_details {
        cast_uuid
        cast_name
        cast_bio
        cast_image_uuid
        cast_image_details { image_uuid file_name file_url }
        cast_type_details { cast_type_uuid cast_type_name }
      }
      tags
      like_status
      total_likes_count
      avg_rating
      child_content {
        content_uuid
        content_name
        content_desc
        content_permalink
        serial_number
        video_details {
          video_uuid
          duration
          hls_path
          resolution_details { resolution url }
        }
        posters {
          website { file_uuid file_name file_url }
        }
      }
    }
  }
`;

/**
 * Build filter string for GraphQL query
 */
function buildFilters(options: GetMoviesOptions): string {
  const filters: string[] = [];

  if (options.page !== undefined) {
    filters.push(`page: ${options.page}`);
  }
  if (options.perPage !== undefined) {
    filters.push(`per_page: ${options.perPage}`);
  }
  if (options.userUuid) {
    filters.push(`user_uuid: "${options.userUuid}"`);
  }
  if (options.contentAssetType) {
    filters.push(`content_asset_type: "${options.contentAssetType}"`);
  }
  if (options.sortBy) {
    filters.push(`sort_by: "${options.sortBy}"`);
  }
  if (options.contentName) {
    filters.push(`content_name: "${options.contentName}"`);
  }
  if (options.categoryUuid) {
    filters.push(`content_category_uuid: "${options.categoryUuid}"`);
  }

  return filters.length > 0 ? `, ${filters.join(', ')}` : '';
}

/**
 * Execute a GraphQL query against the Muvi API
 */
async function executeQuery(
  client: MuviTokenHandler,
  query: string
): Promise<unknown> {
  const token = await client.getAccessToken();
  const url = `${client.baseUrl}/content`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query: `{ ${query} }` }),
  });

  if (!response.ok) {
    // If unauthorized, try refreshing the token once
    if (response.status === 401) {
      const newToken = await client.forceRefresh();
      const retryResponse = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${newToken}`,
        },
        body: JSON.stringify({ query: `{ ${query} }` }),
      });

      if (!retryResponse.ok) {
        throw new MuviApiError(
          `API request failed: ${retryResponse.status} ${retryResponse.statusText}`,
          {
            statusCode: retryResponse.status,
            endpoint: url,
          }
        );
      }

      return retryResponse.json();
    }

    throw new MuviApiError(
      `API request failed: ${response.status} ${response.statusText}`,
      {
        statusCode: response.status,
        endpoint: url,
      }
    );
  }

  return response.json();
}

/**
 * Get a list of movies with basic information
 */
export async function getMovies(
  client: MuviTokenHandler,
  options: GetMoviesOptions = {}
): Promise<GetMoviesResult> {
  const { page = 1, perPage = 10 } = options;

  // Build the query with filters
  const filters = buildFilters({ ...options, page, perPage });
  const query = MOVIES_LIST_QUERY
    .replace(':app_token', await client.getAccessToken())
    .replace(':product_key', client.productKey)
    .replace(':ip_address', MUVI_IP_ADDRESS)
    .replace('{{FILTERS}}', filters);

  try {
    const data = await executeQuery(client, query);

    // Check for API-level error (response without data)
    const apiResponse = data as { status?: string; code?: number; message?: string; data?: unknown };

    if (apiResponse?.status === 'FAILED' || (apiResponse?.code && !apiResponse?.data)) {
      return {
        movies: [] as MuviMovie[],
        totalCount: 0,
        page,
        perPage,
      }
      
    }

    // Validate response, falling back to a lenient envelope parse so an
    // unexpected shape on an item field degrades gracefully instead of throwing.
    const result = MuviContentListResponseSchema.safeParse(data);
    const contentList = result.success
      ? result.data.data.contentList
      : (() => {
          logger.error({ issues: result.error.issues }, 'Muvi validation issues');
          const lenient = MuviContentListEnvelopeSchema.safeParse(data);
          if (!lenient.success) {
            throw new MuviValidationError(
              'Invalid content list response',
              result.error.issues
            );
          }
          return lenient.data.data.contentList;
        })();

    return {
      movies: contentList.content_list as MuviMovie[],
      totalCount: contentList.page_info?.total_count ?? contentList.content_list.length,
      page,
      perPage,
    };
  } catch (error) {
    if (error instanceof MuviApiError || error instanceof MuviValidationError) {
      throw error;
    }
    throw new MuviApiError(
      `Failed to fetch movies: ${error instanceof Error ? error.message : String(error)}`,
      { endpoint: '/content' }
    );
  }
}

/**
 * Get detailed information for a specific movie including assets
 */
export async function getMovieDetails(
  client: MuviTokenHandler,
  contentUuid: string
): Promise<MuviMovieDetails | null> {
  const query = MOVIE_DETAILS_QUERY
    .replace(':app_token', await client.getAccessToken())
    .replace(':product_key', client.productKey)
    .replace(':ip_address', MUVI_IP_ADDRESS)
    .replace(':content_uuid', contentUuid);

  try {
    const data = await executeQuery(client, query);

    // Check for API-level error (response without data)
    const apiResponse = data as { status?: string; code?: number; message?: string; data?: unknown };
    if (apiResponse?.status === 'FAILED' || (apiResponse?.code && !apiResponse?.data)) {
      throw new MuviApiError(
        `Muvi API error: ${apiResponse.message || 'Unknown error'}`,
        { statusCode: apiResponse.code, endpoint: '/content' }
      );
    }

    // Validate response, falling back to a lenient envelope parse so an
    // unexpected shape on a detail field degrades gracefully instead of throwing.
    const result = MuviContentListResponseSchema.safeParse(data);
    const contentList = result.success
      ? result.data.data.contentList.content_list
      : (() => {
          logger.error({ issues: result.error.issues }, 'Muvi validation issues');
          const lenient = MuviContentListEnvelopeSchema.safeParse(data);
          if (!lenient.success) {
            throw new MuviValidationError(
              'Invalid content details response',
              result.error.issues
            );
          }
          return lenient.data.data.contentList.content_list;
        })();

    if (contentList.length === 0) {
      return null;
    }

    return contentList[0] as MuviMovieDetails;
  } catch (error) {
    if (error instanceof MuviApiError || error instanceof MuviValidationError) {
      throw error;
    }
    throw new MuviApiError(
      `Failed to fetch movie details: ${error instanceof Error ? error.message : String(error)}`,
      { endpoint: '/content' }
    );
  }
}
