'use client';

import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';

const FrontendFixtures = lazy(() => import('./frontend-fixtures').then(module => ({ default: module.FrontendFixtures })));
const DenseSurfaceFixtures = lazy(() => import('./dense-surface-fixtures').then(module => ({ default: module.DenseSurfaceFixtures })));
const RankingQueryFixtures = lazy(() => import('./ranking-query-fixtures').then(module => ({ default: module.RankingQueryFixtures })));
const ControllerFixtures = lazy(() => import('./controller-fixtures').then(module => ({ default: module.ControllerFixtures })));
const PlantAttackFixtures = lazy(() => import('./plant-attack-fixtures').then(module => ({ default: module.PlantAttackFixtures })));

export type FixtureSuite = 'all' | 'primitives' | 'dense' | 'controllers' | 'plant-attack';

function ReadyFrame({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return <main data-fixtures-ready={ready} className="mx-auto max-w-6xl space-y-6 p-4">
    <h1 className="text-xl font-semibold">Frontend regression fixtures</h1>
    {children}
  </main>;
}

export function ScopedFixtures({ suite }: { suite: FixtureSuite }) {
  return <Suspense fallback={<p role="status">Loading regression fixtures…</p>}>
    {suite === 'all' || suite === 'primitives' ? <FrontendFixtures includeSecondary={suite === 'all'} />
      : <ReadyFrame>
        {suite === 'dense' && <><DenseSurfaceFixtures /><RankingQueryFixtures /></>}
        {suite === 'controllers' && <ControllerFixtures />}
        {suite === 'plant-attack' && <PlantAttackFixtures />}
      </ReadyFrame>}
  </Suspense>;
}
