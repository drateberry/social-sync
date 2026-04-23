import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      "@social-sync/shared": new URL("../shared/src/index.ts", import.meta.url).pathname,
    },
  },
});
