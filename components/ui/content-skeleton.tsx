import { Skeleton } from "./skeleton";

/** Match the eventual content rhythm and reserve a useful first viewport. */
export function ContentSkeleton({
  kind = "cards",
  label = "Loading content",
}: {
  kind?: "cards" | "list" | "care" | "swap";
  label?: string;
}) {
  return (
    <div
      role="status"
      aria-label={label}
      className={`w-full space-y-5 ${kind === "care" ? "min-h-80" : "min-h-[60dvh] p-4 sm:p-6"}`}
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true" className="space-y-5">
        <div className="flex items-center gap-3">
          <Skeleton className="h-11 w-11 shrink-0 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="h-3 w-24" />
          </div>
        </div>
        {kind === "list" ? (
          Array.from({ length: 6 }, (_, index) => (
            <div
              key={index}
              className="flex items-center gap-3 border-b border-border/50 py-3"
            >
              <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3 w-2/3" />
                <Skeleton className="h-3 w-1/3" />
              </div>
              <Skeleton className="h-4 w-14" />
            </div>
          ))
        ) : kind === "care" ? (
          <>
            <Skeleton className="mx-auto h-24 w-24 rounded-2xl" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-4/5" />
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-11 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </>
        ) : kind === "swap" ? (
          <>
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-32 w-full rounded-2xl" />
            <Skeleton className="h-12 w-full rounded-2xl" />
          </>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }, (_, index) => (
              <div
                key={index}
                className="space-y-4 rounded-2xl border border-border/50 p-4"
              >
                <Skeleton className="mx-auto h-24 w-24 rounded-2xl" />
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
                <Skeleton className="h-11 w-full" />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
