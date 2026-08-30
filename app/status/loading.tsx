export default function StatusLoading() {
  return (
    <main className="min-h-dvh bg-background px-4 py-8" role="status" aria-label="Loading service status">
      <div className="mx-auto w-full max-w-5xl space-y-4">
        <div className="h-16 animate-pulse rounded-[var(--radius-panel)] bg-muted" />
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-32 animate-pulse rounded-[var(--radius-panel)] bg-muted" />
          ))}
        </div>
        <span className="sr-only">Loading service status…</span>
      </div>
    </main>
  );
}
