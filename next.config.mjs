/** @type {import('next').NextConfig} */
const nextConfig = {
  // Silence WalletConnect and other library warnings
  // https://github.com/WalletConnect/walletconnect-monorepo/issues/1908
  webpack: (config, { isServer }) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },

  // Server external packages for optimal bundling
  serverExternalPackages: ["@upstash/redis"],

  // Turbopack optimizations (Next.js 16 default bundler)
  experimental: {
    // Enable filesystem caching for faster dev rebuilds
    turbopackFileSystemCacheForDev: true,
  },

  // Image optimization settings
  images: {
    // Prevent enumeration attacks on local images with query strings
    localPatterns: [
      {
        pathname: "/images/**",
        search: "",
      },
      {
        pathname: "/icons/**",
        search: "",
      },
      {
        pathname: "/PixotchiKit/**",
        search: "",
      },
    ],
    // Increase cache TTL for stable images from 60s to 4 hours (Next.js 16 default)
    minimumCacheTTL: 14400,
  },

  // Redirect old middleware.ts references if any exist
  redirects: async () => [],
};

export default nextConfig;
