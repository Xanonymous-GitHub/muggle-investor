import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [vinext(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
