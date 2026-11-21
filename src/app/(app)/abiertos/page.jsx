import LegacyPage from '@/components/LegacyPage';
import markup from '@/generated/index.markup.js';
import script from '@/generated/index.client.js';
import '@/generated/index.css';

export default function AbiertosPage() {
  return <LegacyPage id="index" markup={markup} script={script} />;
}
