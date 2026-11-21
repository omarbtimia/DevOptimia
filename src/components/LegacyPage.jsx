'use client';

import Script from 'next/script';

export default function LegacyPage({ markup, script, id }) {
  return (
    <>
      <div dangerouslySetInnerHTML={{ __html: markup }} />
      <Script id={`legacy-${id}`} strategy="afterInteractive">{script}</Script>
    </>
  );
}
