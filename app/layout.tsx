import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'ListeningType — listen. type. own it.',
  description:
    'Local English listening practice. Upload a video or paste a YouTube link, then type each sentence as you hear it.',
};

export const viewport: Viewport = {
  themeColor: '#070a09',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
