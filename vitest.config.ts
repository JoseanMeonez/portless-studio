import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/{core,server,cli}/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "web",
          environment: "jsdom",
          include: ["src/web/**/*.test.{ts,tsx}"],
          setupFiles: ["src/web/test/setup.ts"],
        },
      },
    ],
  },
});
