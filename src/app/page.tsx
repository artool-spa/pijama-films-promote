import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';

export default async function HomePage() {
  const session = await getSession();

  if (session) {
    // Logged in users go to films
    redirect('/films');
  } else {
    // Not logged in, go to login
    redirect('/login');
  }
}
