import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        // typescript + the Tailwind compiler are imported at runtime by the
        // extension/widget compile path, so they stay external (resolved from
        // node_modules in the packaged app) rather than bundled.
        external: ["electron", "typescript", "tailwindcss", "@tailwindcss/postcss", "postcss"],
        input: {
          index: resolve(__dirname, "src/main/app.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: ["electron"],
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
        },
        output: {
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react(), tailwindcss()],
    resolve: {
      // Dev/source mode serves widgets through Vite, so the bare design-system
      // specifier resolves to the real module here (sharing the renderer's React
      // instance). Packaged mode rewrites it to the host protocol instead.
      alias: {
        "@babymenu/ui": resolve(__dirname, "src/ui/index.ts"),
      },
    },
    server: {
      port: 5273,
      strictPort: true,
      fs: {
        allow: [resolve(__dirname)],
      },
    },
    build: {
      outDir: resolve(__dirname, "out/renderer"),
    },
  },
});
