/**
 * Film ownership for asset routes.
 *
 * Assets are stored with a bare `filmMuviUuid`. Comparing that with a uuid the
 * client sent proves the request is self-consistent, not that the film is the
 * caller's. This module decides ownership from the SESSION's catalogue:
 *
 * - Atlas session: the film must be in that partner's catalogue in the external
 *   API (`getFilmById`, filtered by the session partnerId). The match is on the
 *   exact uuid; a film can exist twice in MUVI (one record per rights holder),
 *   so never match by title.
 * - Internal user: global catalogue, so there is no ownership boundary to
 *   enforce. Behaviour is unchanged and no MUVI call is made (a region-blocked
 *   film would otherwise make MUVI throw and lock internal users out of assets
 *   they can manage today).
 *
 * Fail-closed: "not yours" and "could not verify" are different errors, and
 * neither ever grants access.
 */

import { NextResponse } from 'next/server';
import { createLogger } from '@/lib/logger';
import { getFilmById, resolveCatalogueSource } from '@/models/film';

const log = createLogger('film-access');

/** The film is not in the session's catalogue. Answered exactly like "does not exist". */
export class FilmNotOwnedError extends Error {
  constructor() {
    super('Film not found');
    this.name = 'FilmNotOwnedError';
  }
}

/** The catalogue could not be read (API down, key missing, no session). */
export class FilmOwnershipUnverifiableError extends Error {
  constructor() {
    super('Could not verify film ownership');
    this.name = 'FilmOwnershipUnverifiableError';
  }
}

/**
 * Resolves when the session may manage assets of `filmMuviUuid`.
 * Throws FilmNotOwnedError (404) or FilmOwnershipUnverifiableError (503).
 * Call it BEFORE reading or writing assets and before any upload.
 */
export async function assertFilmAccessible(filmMuviUuid: string): Promise<void> {
  try {
    const source = await resolveCatalogueSource();

    if (source.kind !== 'atlas') return;

    // includeCampaigns=false: ownership needs no Firestore reads.
    const film = await getFilmById(filmMuviUuid, false);

    if (!film) throw new FilmNotOwnedError();
  } catch (error) {
    if (error instanceof FilmNotOwnedError) throw error;

    // Name only: upstream messages must not reach logs or producers.
    log.error(
      { errName: error instanceof Error ? error.name : 'unknown' },
      'Could not verify film ownership'
    );
    throw new FilmOwnershipUnverifiableError();
  }
}

/**
 * For a route's catch block: the HTTP answer for an ownership failure, or null
 * when `error` is something else.
 */
export function filmAccessResponse(error: unknown): NextResponse | null {
  if (error instanceof FilmNotOwnedError) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  if (error instanceof FilmOwnershipUnverifiableError) {
    return NextResponse.json(
      { error: "We couldn't verify access to this film right now. Please try again in a few minutes." },
      { status: 503 }
    );
  }

  return null;
}
