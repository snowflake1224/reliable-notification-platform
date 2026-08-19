import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@nplat/shared": path.join(root, "packages/shared/src/index.ts")
    }
  },
  test: {
    globals: false,
    fileParallelism: false,
    testTimeout: 120_000,
    hookTimeout: 120_000,
    include: ["tests/**/*.test.ts"]
  }
});
