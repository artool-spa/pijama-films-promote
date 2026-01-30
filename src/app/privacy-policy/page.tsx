import { Metadata } from 'next';
import PrivacyPolicyClient from './client';

export const metadata: Metadata = {
  title: 'Privacy Policy | Pijama Films',
  description: 'Privacy Policy for Pijama Films - Advertising platform for independent cinema',
};

export default function PrivacyPolicyPage() {
  return <PrivacyPolicyClient />;
}
