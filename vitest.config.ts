import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mirror the renderer alias so tests resolve the design system the same way
    // dev/source mode does (packaged mode rewrites it to the host protocol).
    alias: {
      "@babymenu/ui": resolve(__dirname, "src/ui/index.ts"),
    },
  },
  test: {
    exclude: ["**/node_modules/**", "**/.git/**", "**/.cache/**"],
  },
});
