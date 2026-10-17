import type { NextConfig } from "next";

/**
 * Optional peer dependencies pulled in transitively by wallet connectors
 * (wagmi → @base-org/account → @coinbase/cdp-sdk, WalletConnect logging, MetaMask SDK).
 * None are used by RoviumPad; aliasing them to `false` keeps them out of the bundle.
 */
const OPTIONAL_MODULES = [
  "@x402/core/client",
  "@x402/evm/exact/client",
  "@x402/evm/upto/client",
  "@x402/fetch",
  "pino-pretty",
  "lokijs",
  "encoding",
  "@react-native-async-storage/async-storage",
];

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  // Lets a production build run alongside `next dev` (e.g. NEXT_DIST_DIR=.next-build).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ["@prisma/client", "sharp", "bullmq", "ioredis"],
  webpack: (config, { webpack }) => {
    // Every @x402/* module is an optional payment add-on of the Coinbase CDP SDK.
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^@x402\// }));
    config.resolve = config.resolve ?? {};
    config.resolve.alias = {
      ...(config.resolve.alias as Record<string, unknown>),
      ...Object.fromEntries(OPTIONAL_MODULES.map((m) => [m, false])),
    };
    return config;
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
