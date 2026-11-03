import type { Metadata } from 'next';
import React from 'react';
import '../src/design-tokens.css';
import '../src/styles.css';
import { AppProviders } from './providers';

export const metadata: Metadata = {
  title: 'Falchion Xeniaa · People Portal',
  description: 'Falchion Xeniaa employee attendance, leave and workplace portal.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
        <meta name="theme-color" content="#931314" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <link rel="icon" href="/falchion-xeniaa-mark.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/falchion-xeniaa-mark.svg" />
        <link rel="manifest" href="/manifest.webmanifest" />
        <script
          dangerouslySetInnerHTML={{
            __html: `try{document.documentElement.dataset.theme=localStorage.getItem("hrms-theme")||"light";}catch{document.documentElement.dataset.theme="light";}`,
          }}
        />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
