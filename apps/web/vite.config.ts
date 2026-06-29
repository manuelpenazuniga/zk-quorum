import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  publicDir: "public",
  build: {
    outDir: "dist",
    target: "es2022",
    sourcemap: true,
    rollupOptions: {
      input: {
        voter: "voter.html",
        admin: "admin.html",
        audit: "audit.html",
      },
    },
  },
  worker: {
    format: "es",
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
