/** @type {import('next').NextConfig} */
const nextConfig = {
  // Treat optional Node-only deps as externals for server bundles (works with Turbopack & webpack)
  serverExternalPackages: ["pino-pretty", "lokijs", "encoding"],
};

export default nextConfig;
