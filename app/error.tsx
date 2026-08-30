'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';
import { track } from '@vercel/analytics';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[CLIENT ERROR]', {
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      timestamp: new Date().toISOString(),
    });
    track('client_error', {
      boundary: 'route',
      digest: error.digest ?? 'none',
      errorName: error.name || 'Error',
      path: window.location.pathname,
    });
  }, [error]);

  return (
    <div className="safe-area-inset h-dvh overflow-y-auto bg-background" role="main" aria-labelledby="error-title">
      <div className="flex min-h-full w-full">
      <Card className="mx-auto my-auto w-full max-w-md">
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
          <h1 id="error-title" className="text-lg font-semibold mb-2">We hit a temporary app error</h1>
          <p className="text-muted-foreground mb-4">
            We&apos;ve encountered an unexpected error. Don&apos;t worry, your plants are safe!
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
            <details className="mt-4 text-left" role="region" aria-label="Error details">
              <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
                Error details (development only)
              </summary>
              <pre className="mt-2 text-xs bg-muted p-2 rounded overflow-auto" role="log" aria-live="off">
                {error.message}
              </pre>
            </details>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
