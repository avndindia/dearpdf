import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
    };
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
};

export default nextConfig;
