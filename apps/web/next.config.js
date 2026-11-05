/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ["@trip-planner/core", "@trip-planner/db"],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client"],
  },
};

module.exports = nextConfig;
