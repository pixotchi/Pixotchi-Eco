// Loading surface re-exports.
//
// The former LoadingSpinner / LoadingCard / LoadingPlantCard / LoadingGrid / PageLoader
// exports were removed: none had a single importer, and LoadingGrid/LoadingPlantCard in
// particular modelled a card-grid dashboard this app does not have, so reaching for them
// would have introduced layout shift rather than removed it.
//
// The `LoadingLogo` alias and `BaseExpandedLoadingSpinner` went the same way, for the same
// reason. BaseExpandedLoadingLogo itself stays — BaseExpandedLoadingPageLoader renders it.
//
// For content placeholders use `components/ui/skeleton.tsx` and shape it like the real
// layout. For a full-surface loader use BaseExpandedLoadingPageLoader (aliased as
// BasePageLoader for the app shell).
export { BaseAnimatedLogo } from './BaseAnimatedLogo';
export {
  BaseExpandedLoadingPageLoader,
  BaseExpandedLoadingPageLoader as BasePageLoader,
} from './BaseExpandedLoadingLogo';
