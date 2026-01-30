import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import LoginClient from './client';

export default async function LoginPage() {
  // If already logged in, redirect to home
  const session = await getSession();
  if (session) {
    redirect('/films');
  }

  return <LoginClient />;
}
