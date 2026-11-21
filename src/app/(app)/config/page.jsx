import { redirect } from 'next/navigation';
import { getSessionUser } from '@/lib/auth';
import LegacyPage from '@/components/LegacyPage';
import markup from '@/generated/config.markup.js';
import script from '@/generated/config.client.js';
import '@/generated/config.css';

export default async function ConfigPage() {
  const user = await getSessionUser();
  if (user?.role !== 'Administrador') redirect('/');
  return <LegacyPage id="config" markup={markup} script={script} />;
}
