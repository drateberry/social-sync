/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@social-sync/shared"],
  env: {
    NEXT_PUBLIC_WORKER_URL: process.env.WORKER_URL ?? "",
  },
};

export default nextConfig;
