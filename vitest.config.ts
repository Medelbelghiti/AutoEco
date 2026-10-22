import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30000,
    // Real-DB suites pay a bcrypt cost-12 + Postgres round-trip in their
    // beforeAll hooks; under a loaded machine 10s was not always enough and
    // the suite reported a hook timeout instead of a real result.
    hookTimeout: 30000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
