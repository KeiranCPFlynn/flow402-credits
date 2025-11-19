import type { NextConfig } from "next";
import { config } from "dotenv";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const loadEnv = (relativePath: string, override = false) => {
  const absolutePath = resolve(__dirname, relativePath);
  if (existsSync(absolutePath)) {
    config({ path: absolutePath, override });
  }
};

// Load shared + local env files, then optional chain-specific overrides
loadEnv("../../.env");
loadEnv(".env.local", true);

const extraEnvFile = process.env.FLOW402_ENV_FILE;
if (extraEnvFile) {
  loadEnv(extraEnvFile, true);
}

const nextConfig: NextConfig = {
  reactCompiler: true,
};

export default nextConfig;
