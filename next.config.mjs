const SERVER_EXTERNAL_PACKAGES = [
  "pino",
  "thread-stream",
  "pino-elasticsearch",
  "fastbench",
  "tap",
  "tape",
  "desm",
  "why-is-node-running",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  turbopack: {},
  // Silence warnings
  // https://github.com/WalletConnect/walletconnect-monorepo/issues/1908
  webpack: (config) => {
    config.externals.push("pino-pretty", "lokijs", "encoding");
    return config;
  },
  // External packages for server components
  serverExternalPackages: SERVER_EXTERNAL_PACKAGES,
  // Configure Next.js Image optimization qualities
  images: {
    qualities: [75, 80, 85, 90],
  },
};

export default nextConfig;
