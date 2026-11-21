import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';

export default async function AppLayout({ children }) {
  const user = await getSessionUser();
  if (!user) redirect('/login');
  return children;
}
