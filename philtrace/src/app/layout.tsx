import type { Metadata } from 'next';
import './globals.css';
import { QueryProvider } from '@/lib/query-client';
import { Header } from '@/components/header';
import { MainLayoutWrapper } from '@/components/main-layout-wrapper';

export const metadata: Metadata = {
  title: "MapaTunAI: Mapping What's Real — Exposing Ghost Projects Across the Philippines",
  description: "MapaTunAI: Mapping What's Real — Exposing Ghost Projects Across the Philippines. Track, investigate, and verify public infrastructure contracts with citizen truth and satellite proof.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              if (typeof window !== 'undefined') {
                if ('serviceWorker' in navigator) {
                  navigator.serviceWorker.getRegistrations().then(function(registrations) {
                    for (var i = 0; i < registrations.length; i++) {
                      registrations[i].unregister();
                    }
                  }).catch(function() {});
                }
                if ('caches' in window) {
                  caches.keys().then(function(keys) {
                    for (var i = 0; i < keys.length; i++) {
                      caches.delete(keys[i]);
                    }
                  }).catch(function() {});
                }
                window.addEventListener('unhandledrejection', function(event) {
                  if (event && event.reason && (
                    String(event.reason.message || event.reason).indexOf('Cache') !== -1 ||
                    String(event.reason.message || event.reason).indexOf('put') !== -1
                  )) {
                    event.preventDefault();
                  }
                });
              }
            `,
          }}
        />
      </head>
      <body className="min-h-screen bg-gray-50 text-gray-900 antialiased overflow-x-hidden">
        <QueryProvider>
          <Header />
          <MainLayoutWrapper>
            {children}
          </MainLayoutWrapper>
        </QueryProvider>
      </body>
    </html>
  );
}
