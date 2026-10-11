import path from "node:path";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vinext()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
