/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: Vite on 127.0.0.1:5190 proxies /api to the FastAPI backend on 8790.
// Prod: FastAPI serves frontend/dist at / so no proxy is needed.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5190,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8790",
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          charts: ["recharts"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/__tests__/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
