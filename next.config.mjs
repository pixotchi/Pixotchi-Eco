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
  // Silence warnings
  // https://github.com/WalletConnect/walletconnect-monorepo/issues/1908
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");

    // Solana/Privy: Add webpack externals for Yarn compatibility
    // See: https://docs.privy.io/basics/react/setup#solana
    if (process.env.NEXT_PUBLIC_SOLANA_ENABLED === 'true') {
      config.externals['@solana/kit'] = 'commonjs @solana/kit';
      config.externals['@solana-program/memo'] = 'commonjs @solana-program/memo';
      config.externals['@solana-program/system'] = 'commonjs @solana-program/system';
      config.externals['@solana-program/token'] = 'commonjs @solana-program/token';
    }

    // Resolve @solana/kit to a single version to avoid nested dependency issues
    config.resolve.alias = {
      ...config.resolve.alias,
      "@solana/kit": require.resolve("@solana/kit"),
    };
    return config;
  },
  // External packages for server components
  serverExternalPackages: ["pino", "pino-pretty", "thread-stream", "lokijs", "encoding"],
  // Configure Next.js Image optimization qualities
  images: {
    qualities: [75, 80, 85, 90],
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
