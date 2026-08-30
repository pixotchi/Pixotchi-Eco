'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';
import { track } from '@vercel/analytics';
// global-error replaces the root layout, so neither the stylesheet nor the font
// variables from app/layout.tsx are present. Import both or the crash screen
// renders as unstyled HTML with system fonts.
import './globals.css';
import { coinbaseSans, pixelmix } from './fonts';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[GLOBAL ERROR]', {
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      timestamp: new Date().toISOString(),
    });
    track('client_error', {
      boundary: 'global',
      digest: error.digest ?? 'none',
      errorName: error.name || 'Error',
      path: window.location.pathname,
    });
  }, [error]);

  return (
    <html lang="en" className={`h-full ${coinbaseSans.variable} ${pixelmix.variable}`}>
      <head>
        <title>Critical Error - Pixotchi</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </head>
      <body className="h-full bg-background">
        <div className="flex flex-col h-full bg-background items-center justify-center p-4">
          <Card className="max-w-md w-full">
            <CardContent className="p-6 text-center">
              <Image
                src="/PixotchiKit/Logonotext.svg"
                alt="Pixotchi Logo"
                width={64}
                height={64}
                sizes="64px"
                quality={90}
                preload
                className="mx-auto mb-4 opacity-50"
              />
              <h1 className="text-lg font-semibold mb-2">Critical Error</h1>
              <p className="text-muted-foreground mb-4">
                A critical error occurred. Please try refreshing the page.
              </p>
              <div className="space-y-3">
                <Button
                  onClick={reset}
                  className="w-full"
                  aria-label="Try again to recover from error"
                >
                  Try again
                </Button>
                <Button
                  variant="outline"
                  onClick={() => window.location.reload()}
                  className="w-full"
                  aria-label="Refresh the page"
                >
                  Refresh Page
                </Button>
              </div>
              {process.env.NODE_ENV === 'development' && (
                <details className="mt-4 text-left">
                  <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                    Error details (development only)
                  </summary>
                  <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto">
                    {error.message}
                  </pre>
                </details>
              )}
            </CardContent>
          </Card>
        </div>
      </body>
    </html>
  );
}
