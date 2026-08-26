/**
 * Controller for `https://promote.pijamafilms.com/auth` — the URL Atlas Console
 * opens with `_blank` before posting `ATLAS_AUTH` (Contract B).
 *
 * Replaces the 404 probe route that used to live here. `page.tsx` and `route.ts`
 * cannot coexist in one segment, so `src/app/auth/route.ts` was deleted.
 *
 * Query parameters (diagnostics only, both safe to expose):
 *   ?mode=probe    run Contract A in read-only mode; never issues a session.
 *                  Default is `login`, which is the real Console flow.
 *   ?origins=strict  drop the development self-origin allowance, so a locally
 *                  posted message is rejected exactly as a wrong origin would be
 *                  in production.
 */
import type { Metadata } from 'next';
import {
  DEFAULT_HANDSHAKE_TIMEOUT_MS,
  parseAllowedOrigins,
  type AtlasSessionMode,
} from './atlas-bridge';
import { buildBridgeScript } from './bridge-script';
import AtlasAuthClient from './client';

export const metadata: Metadata = {
  title: 'Signing in — Pijama Films Promote',
  robots: { index: false, follow: false },
};

interface AtlasAuthPageProps {
  searchParams: Promise<{ mode?: string; origins?: string }>;
}

export default async function AtlasAuthPage({ searchParams }: AtlasAuthPageProps) {
  const { mode, origins } = await searchParams;

  const allowedOrigins = parseAllowedOrigins(
    process.env.NEXT_PUBLIC_ATLAS_ALLOWED_ORIGINS
  );
  const strictOrigins = origins === 'strict';
  const allowSelfOrigin = process.env.NODE_ENV !== 'production' && !strictOrigins;
  const resolvedMode: AtlasSessionMode = mode === 'probe' ? 'probe' : 'login';

  const bridgeScript = buildBridgeScript({ allowedOrigins, allowSelfOrigin });

  return (
    <>
      {/*
        Rendered inline and executed during document parse: the listener has to
        exist before Console posts, and before the React bundle has loaded.
      */}
      <script
        id="atlas-auth-bridge"
        dangerouslySetInnerHTML={{ __html: bridgeScript }}
      />
      <AtlasAuthClient
        allowedOrigins={allowedOrigins}
        allowSelfOrigin={allowSelfOrigin}
        mode={resolvedMode}
        timeoutMs={DEFAULT_HANDSHAKE_TIMEOUT_MS}
      />
    </>
  );
}
