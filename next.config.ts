import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
  // Transformers.js (DistilBART) is browser-only; keep Node ORT/sharp out of the client graph.
  serverExternalPackages: ["onnxruntime-node", "sharp"],
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      canvas: false,
      sharp: false,
      "onnxruntime-node": false,
    };
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    return config;
  },
};

export default nextConfig;
