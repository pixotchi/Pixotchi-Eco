'use client';

import { memo, useEffect, useState, type ComponentType } from 'react';
import { Button } from '@/components/ui/button';
import { BasePageLoader } from '@/components/ui/loading';
import { createRetryableResource } from '@/lib/retryable-resource';

/** Client-only chunk loading with a local retry; retained tabs/drafts stay mounted. */
export function createRetryableTab(importModule: () => Promise<{ default: ComponentType }>, name: string) {
  const load = createRetryableResource(importModule);
  const Tab = memo(function RetryableTab() {
    const [component, setComponent] = useState<ComponentType | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    useEffect(() => {
      let current = true;
      void load().then((module) => {
        if (current) setComponent(() => module.default);
      }).catch(() => { if (current) setFailed(true); });
      return () => { current = false; };
    }, [attempt]);
    if (component) { const Component = component; return <Component />; }
    if (!failed) return <BasePageLoader />;
    return <div className="space-y-4 p-8 text-center" role="alert">
      <p className="text-sm font-medium">Could not load {name}.</p>
      <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
      <Button variant="outline" onClick={() => { setFailed(false); setAttempt((value) => value + 1); }}>Retry loading {name}</Button>
    </div>;
  });
  Tab.displayName = `RetryableTab(${name})`;
  return Tab;
}
