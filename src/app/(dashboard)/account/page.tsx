import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { getPartnerByPartnerId } from '@/models/partner';
import { getAccountWithTransactions } from '@/models/account';
import AccountClient from './client';

export const dynamic = 'force-dynamic';

type SearchParams = {
  payment?: string;
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const session = await getSession();
  if (!session) {
    redirect('/login');
  }

  const partner = await getPartnerByPartnerId(session.partnerId);
  if (!partner) {
    redirect('/login');
  }

  const params = await searchParams;
  const account = await getAccountWithTransactions(partner.id, { limit: 20, offset: 0 });

  return (
    <AccountClient
      account={account}
      paymentStatus={params.payment || null}
    />
  );
}
