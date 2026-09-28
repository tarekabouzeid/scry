import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Self-contained server bundle for the production Docker image
  // (infra/docker) — only the traced node_modules subset, not the full tree.
  output: "standalone",
};

export default nextConfig;
