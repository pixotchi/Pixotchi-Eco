const rawAppBuildId =
  process.env.NEXT_PUBLIC_APP_BUILD_ID ||
  process.env.VERCEL_DEPLOYMENT_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.npm_package_version ||
  "development";
const appBuildId = rawAppBuildId.replace(/[^a-zA-Z0-9_-]/g, "-");

/** @type {import('next').NextConfig} */
const nextConfig = {
  ...(process.env.NODE_ENV === "production" ? { deploymentId: appBuildId } : {}),
  turbopack: {},
  // NOTE: cacheComponents is NOT enabled because it's incompatible with
  // dynamic/runtime/revalidate segment configs used for fresh onchain data
  // NOTE: a webpack() config used to live here. Next 16 builds with Turbopack by
  // default for both `next dev` and `next build`, so it was never invoked — and
  // the empty `turbopack` key above suppressed the warning that would have said so.
  // Nothing in it did live work: pino-pretty/lokijs/encoding are already handled by
  // serverExternalPackages below, and the @solana/kit externals + dedupe alias are
  // not needed under Turbopack's resolver.
  // External packages for server components
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream", "lokijs", "encoding"],
  // Configure Next.js Image optimization qualities and formats (AVIF first —
  // the pixel-art PNG/WebP set compresses substantially further as AVIF).
  images: {
    qualities: [75, 80, 85, 90],
    formats: ["image/avif", "image/webp"],
  },
  experimental: {
    // Next's default optimizePackageImports list covers lucide-react and
    // radix; ethereum-identity-kit is the one heavy client dep it misses.
    optimizePackageImports: ["ethereum-identity-kit"],
  },
  env: {
    NEXT_PUBLIC_APP_BUILD_ID: appBuildId,
  },
  async redirects() {
    const redirects = [];

    if (process.env.NEXT_PUBLIC_STATUS_ONLY === 'true') {
      // When serving the standalone status app, no external redirects needed.
    } else {
      redirects.push({
        source: '/status',
        destination: 'https://status.pixotchi.tech',
        permanent: false,
      });
    }

    return redirects;
  },
  async rewrites() {
    if (process.env.NEXT_PUBLIC_STATUS_ONLY === 'true') {
      return [
        {
          source: '/',
          destination: '/status',
        },
      ];
    }
    return [];
  },
};

export default nextConfig;
