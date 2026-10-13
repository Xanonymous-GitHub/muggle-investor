import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: {
    projects: [
      {
        test: {
          name: "node",
          include: ["test/**/*.test.ts", "src/**/*.test.ts"],
          exclude: ["**/node_modules/**", "src/ui/**"],
          environment: "node",
        },
      },
      {
        // `next/*` comes from vinext's build plugin; under plain Vitest these stand in for it.
        resolve: {
          alias: {
            "next/link": path.resolve(import.meta.dirname, "src/ui/test/next-link.tsx"),
            "next/navigation": path.resolve(import.meta.dirname, "src/ui/test/next-navigation.ts"),
          },
        },
        test: {
          name: "dom",
          include: ["src/ui/**/*.test.{ts,tsx}"],
          environment: "happy-dom",
          setupFiles: ["src/ui/test/setup.ts"],
        },
      },
    ],
  },
});
