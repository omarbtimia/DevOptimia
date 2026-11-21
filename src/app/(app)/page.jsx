import LegacyPage from '@/components/LegacyPage';
import markup from '@/generated/home.markup.js';
import script from '@/generated/home.client.js';
import '@/generated/home.css';

export default function HomePage() {
  return <LegacyPage id="home" markup={markup} script={script} />;
}
