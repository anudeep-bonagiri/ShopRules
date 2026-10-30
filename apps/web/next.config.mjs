/** @type {import('next').NextConfig} */
const corsHeaders = [
  { key: "Access-Control-Allow-Origin", value: "*" },
  { key: "Access-Control-Allow-Methods", value: "GET,POST,PATCH,DELETE,OPTIONS" },
  { key: "Access-Control-Allow-Headers", value: "Content-Type, X-SR-Token" },
];

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@shopify/polaris"],
  async headers() {
    return [{ source: "/api/:path*", headers: corsHeaders }];
  },
};

export default nextConfig;
