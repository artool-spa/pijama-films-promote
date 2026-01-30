/**
 * Meta Locations API Endpoint
 *
 * GET /api/meta/locations?q=<query>&types=country&limit=20
 *
 * Searches for locations using Meta's Targeting Search API.
 * Used for dynamic location autocomplete in campaign targeting.
 */

import { NextRequest, NextResponse } from 'next/server';
import { meta } from '@/lib/meta';
import {
  searchLocations,
  getDefaultCountries,
  MetaLocationType,
  MetaLocationTypeSchema,
} from '@/lib/meta/locations';
import { MetaApiError } from '@/lib/meta/errors';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const query = searchParams.get('q') || '';
  const typesParam = searchParams.get('types') || 'country';
  const countryCode = searchParams.get('country_code') || undefined;
  const limit = Math.min(Number(searchParams.get('limit')) || 20, 50);

  // Parse location types
  const typeStrings = typesParam.split(',').map((t) => t.trim());
  const types: MetaLocationType[] = [];

  for (const typeStr of typeStrings) {
    const parsed = MetaLocationTypeSchema.safeParse(typeStr);
    if (parsed.success) {
      types.push(parsed.data);
    }
  }

  // Default to country if no valid types
  if (types.length === 0) {
    types.push('country');
  }

  // If no query, return default countries for initial load
  if (!query.trim()) {
    return NextResponse.json({
      data: getDefaultCountries(),
      source: 'default',
    });
  }

  try {
    const locations = await searchLocations(meta, query, types, countryCode, limit);

    // If no results from API, filter default countries by query
    if (locations.length === 0 && types.includes('country')) {
      const filtered = getDefaultCountries().filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.country_code?.toLowerCase() === query.toLowerCase()
      );

      return NextResponse.json({
        data: filtered,
        source: 'fallback',
      });
    }

    return NextResponse.json({
      data: locations,
      source: 'meta_api',
    });
  } catch (error) {
    console.error('Location search error:', error);

    // On API error, return filtered defaults as fallback
    if (types.includes('country')) {
      const filtered = getDefaultCountries().filter(
        (c) =>
          c.name.toLowerCase().includes(query.toLowerCase()) ||
          c.country_code?.toLowerCase() === query.toLowerCase()
      );

      return NextResponse.json({
        data: filtered,
        source: 'fallback',
        error: error instanceof MetaApiError ? error.message : 'API error',
      });
    }

    return NextResponse.json(
      {
        error: error instanceof MetaApiError ? error.message : 'Failed to search locations',
        data: [],
      },
      { status: 500 }
    );
  }
}
