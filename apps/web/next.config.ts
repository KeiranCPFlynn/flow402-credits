import type { NextConfig } from "next";
import { config } from "dotenv";
import { resolve } from "path";

// ✅ Load the shared .env from the monorepo root
config({ path: resolve(__dirname, "../../.env") });

const nextConfig: NextConfig = {
  reactCompiler: true, // your existing flag
  // You can add other Next.js options here if needed
};

export default nextConfig;
