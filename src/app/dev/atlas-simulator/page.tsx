/**
 * Controller for the local Atlas Console stand-in.
 *
 * It exists so the whole of our half of the SSO can be exercised without Crazy
 * Cake and without lab credentials. It must not exist in production: `notFound()`
 * runs before any of the view is rendered, so the route answers 404 there and the
 * client bundle is never reached.
 */
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import AtlasSimulatorClient from './client';

export const metadata: Metadata = {
  title: 'Atlas Console simulator (development only)',
  robots: { index: false, follow: false },
};

export default async function AtlasSimulatorPage() {
  if (process.env.NODE_ENV === 'production') {
    notFound();
  }

  return <AtlasSimulatorClient />;
}
