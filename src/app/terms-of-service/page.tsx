import { Metadata } from 'next';
import TermsOfServiceClient from './client';

export const metadata: Metadata = {
  title: 'Terms of Service | Pijama Films',
  description: 'Terms of Service for Pijama Films - Advertising platform for independent cinema',
};

export default function TermsOfServicePage() {
  return <TermsOfServiceClient />;
}
