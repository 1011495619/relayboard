import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: "web",
  plugins: [tailwindcss()],
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./web/src", import.meta.url)) },
  },
  build: {
    outDir: "../dist",
    emptyOutDir: true,
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          warning.message.includes('"use client"')
        )
          return;
        warn(warning);
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/@base-ui")) return "base-ui";
          if (
            id.includes("node_modules/react") ||
            id.includes("node_modules/scheduler")
          )
            return "react";
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:4317", "/mcp": "http://127.0.0.1:4317" },
  },
});
