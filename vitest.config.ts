import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  // `scripts/` is in scope because the release tooling that renames
  // artifacts and rewrites the updater manifest lives there, and a mistake
  // in it breaks in-app updates for every existing install.
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.mjs"],
  },
});
