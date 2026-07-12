/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Engine & shared are TS-source workspace packages; let Next transpile them.
  transpilePackages: ['@cardadda/engine', '@cardadda/crazy8-engine', '@cardadda/thirtyone-engine', '@cardadda/shared'],
};

export default nextConfig;
