import './globals.css';
import Script from 'next/script';
import { RPC_SHIM_SOURCE } from '@/components/rpcShim';

export const metadata = {
  title: 'Optimia - Dashboard',
  description: 'Gestión de proyectos Optimia',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <head>
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.3/font/bootstrap-icons.min.css" />
        <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/css/select2.min.css" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body>
        <Script id="optimia-rpc-shim" strategy="beforeInteractive">{RPC_SHIM_SOURCE}</Script>
        <Script src="https://cdn.jsdelivr.net/npm/jquery@3.7.1/dist/jquery.min.js" strategy="beforeInteractive" />
        <Script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js" strategy="beforeInteractive" />
        <Script src="https://cdn.jsdelivr.net/npm/select2@4.1.0-rc.0/dist/js/select2.min.js" strategy="beforeInteractive" />
        <Script src="https://cdn.ckeditor.com/ckeditor5/41.4.2/classic/ckeditor.js" strategy="beforeInteractive" />
        {children}
      </body>
    </html>
  );
}
