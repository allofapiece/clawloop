import { defineConfig } from "vitest/config";

// Tests live under test/ so the `tsc` build (src/** only) never compiles them.
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
});
