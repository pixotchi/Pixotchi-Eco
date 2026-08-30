export default function MintShareLoading() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-6 py-12">
      <div className="w-full max-w-2xl animate-pulse space-y-6 text-center" role="status" aria-label="Loading mint share">
        <div className="mx-auto h-32 w-32 rounded-[var(--radius-panel)] bg-muted" />
        <div className="mx-auto h-4 w-28 rounded bg-muted" />
        <div className="mx-auto h-10 w-full max-w-lg rounded bg-muted" />
        <div className="mx-auto h-5 w-full max-w-xl rounded bg-muted" />
        <span className="sr-only">Loading mint share…</span>
      </div>
    </main>
  );
}
