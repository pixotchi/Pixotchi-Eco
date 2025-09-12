'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import Image from 'next/image';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Log the error to console (will appear in Vercel logs)
    console.error('[CLIENT ERROR]', {
      message: error.message,
      stack: error.stack,
      digest: error.digest,
      timestamp: new Date().toISOString(),
    });
  }, [error]);

  return (
    <div className="flex flex-col h-dvh bg-background items-center justify-center p-4" role="main" aria-labelledby="error-title">
      <Card className="max-w-md w-full">
        <CardContent className="p-6 text-center">
          <Image
            src="/PixotchiKit/Logonotext.svg"
            alt="Pixotchi Logo"
            width={64}
            height={64}
            className="mx-auto mb-4 opacity-50"
            priority
          />
          <h1 id="error-title" className="text-xl font-semibold mb-2">Something went wrong!</h1>
          <p className="text-muted-foreground mb-4">
            We've encountered an unexpected error. Don't worry, your plants are safe!
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
  );
}