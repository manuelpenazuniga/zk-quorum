import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: ".",
  publicDir: "public",
  resolve: {
    alias: {
      "@zk-quorum/protocol": fileURLToPath(new URL("../../packages/protocol/src/index.ts", import.meta.url)),
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        voter: "voter.html",
        admin: "admin.html",
        audit: "audit.html",
        harness: "harness.html",
      },
    },
  },
  server: {
    port: 8788,
    strictPort: true,
  },
  preview: {
    port: 8788,
    strictPort: true,
  },
});
