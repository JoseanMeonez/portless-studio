import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// In development the API server runs on 4321 (see `pnpm dev:server`).
const devServer = "http://127.0.0.1:4321";

export default defineConfig({
  root: "src/web",
  plugins: [react()],
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    target: "es2022",
  },
  server: {
    proxy: { "/api": { target: devServer, changeOrigin: true } },
  },
});
