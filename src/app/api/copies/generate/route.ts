import { NextRequest, NextResponse } from 'next/server';
import logger from '@/lib/logger';
import {
  getGeminiClient,
  generateCopiesForFilm,
  CopyGenerationRequestSchema,
  GeminiApiError,
  GeminiValidationError,
} from '#gemini';
import { muvi, getMovieDetails } from '#muvi';
import type { FilmDataForPrompt } from '#gemini';
import { getPartnerFromRequest } from '@/lib/auth';
import { assertFilmAccessible, filmAccessResponse } from '@/lib/assets/film-access';

/**
 * POST /api/copies/generate
 * Generate marketing copies for a film using Gemini AI
 *
 * Request body:
 * {
 *   filmId: string,
 *   languages?: ['es', 'en', 'pt'] // defaults to all three
 * }
 *
 * Response:
 * {
 *   copies: {
 *     es: [{ headline, primaryText, description, callToAction, variant: 'A' }, ...],
 *     en: [...],
 *     pt: [...]
 *   },
 *   cached: boolean
 * }
 */
export async function POST(req: NextRequest) {
  const partner = await getPartnerFromRequest(req);
  if (!partner) {
    return NextResponse.json({ error: 'No autorizado' }, { status: 401 });
  }

  try {
    const body = await req.json();

    // Validate request
    const result = CopyGenerationRequestSchema.safeParse(body);
    if (!result.success) {
      return NextResponse.json(
        { error: 'Datos inválidos', details: result.error.flatten() },
        { status: 400 }
      );
    }

    const { filmId, languages } = result.data;

    // Before MUVI and before Gemini (which costs money).
    await assertFilmAccessible(filmId);

    // Fetch film data from MUVI API
    const movie = await getMovieDetails(muvi, filmId);
    if (!movie) {
      return NextResponse.json(
        { error: 'Película no encontrada' },
        { status: 404 }
      );
    }

    // Extract genres from categories
    const genres = movie.categories
      ?.map((cat) => cat.category_name)
      .filter((name): name is string => Boolean(name)) || [];

    // Extract director from cast details
    const director = movie.cast_details?.find(
      (cast) => cast.cast_type_details?.cast_type_name?.toLowerCase() === 'director'
    )?.cast_name || '';

    // Prepare film data for prompt
    const filmData: FilmDataForPrompt = {
      id: movie.content_uuid,
      title: movie.content_name || 'Sin título',
      description: movie.content_desc || '',
      genre: genres,
      director,
      year: movie.content_created_date
        ? new Date(movie.content_created_date).getFullYear()
        : new Date().getFullYear(),
      duration: parseDuration(movie.video_details?.duration),
    };

    // Always generate fresh copies for every requested language (no caching)
    const generatedCopies = await generateCopiesForFilm(
      getGeminiClient(),
      filmData,
      languages
    );

    return NextResponse.json({
      copies: generatedCopies,
      cached: false,
    });
  } catch (error) {
    const denied = filmAccessResponse(error);
    if (denied) return denied;

    logger.error({ err: error }, 'Error generating copies');

    if (error instanceof GeminiApiError) {
      return NextResponse.json(
        { error: 'Error al generar copias con IA', details: error.message },
        { status: 502 }
      );
    }

    if (error instanceof GeminiValidationError) {
      return NextResponse.json(
        { error: 'Error al procesar respuesta de IA', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: 'Error interno del servidor' },
      { status: 500 }
    );
  }
}

/**
 * Parse duration from string (e.g., "01:44:04") or number to minutes
 */
function parseDuration(duration?: string | number | null): number {
  if (!duration) return 0;
  if (typeof duration === 'number') return duration;

  // Parse "HH:MM:SS" format to minutes
  const parts = duration.split(':').map(Number);
  if (parts.length === 3) {
    const [hours, minutes] = parts;
    return hours * 60 + minutes;
  }
  return 0;
}
