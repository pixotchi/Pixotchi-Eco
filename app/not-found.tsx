import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-semibold text-foreground">Page not found</h1>
        <p className="text-muted-foreground">The page you are looking for does not exist.</p>
        <Link href="/" className="inline-flex rounded-md border px-4 py-2 text-sm hover:bg-accent">
          Go home
        </Link>
      </div>
    </div>
  );
}


