import React, { lazy, Suspense } from 'react';
export default function dynamic(loader: () => Promise<unknown>) {
  const Loaded = lazy(async () => { const value = await loader() as { default?: React.ComponentType } | React.ComponentType; return { default: (typeof value === 'function' ? value : value.default) as React.ComponentType<Record<string, unknown>> }; });
  return function FixtureDynamic(props: Record<string, unknown>) { return <Suspense fallback={null}><Loaded {...props} /></Suspense>; };
}
