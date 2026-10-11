import path from "node:path";
import { createApi, createContext, main as serwistMain } from "@serwist/vite";
import tailwindcss from "@tailwindcss/vite";
import { nitro } from "nitro/vite";
import vinext from "vinext";
import { defineConfig, type Plugin } from "vite";

/**
 * `@serwist/vite`'s own build plugin targets the top-level `build.outDir`, which under
 * vinext + Nitro (multi-environment build) is not where client assets land. This variant
 * generates the service worker after the `client` environment finishes, into that
 * environment's outDir (`.output/public` for the node preset, `.vercel/output/static` for
 * vercel), precaching the hashed `_next/static` assets found there.
 */
function serwistForClientEnvironment(): Plugin[] {
  const ctx = createContext(
    {
      swSrc: "src/sw.ts",
      swDest: "sw.js",
      // Placeholder for option validation; replaced with the client outDir at build time.
      globDirectory: ".",
      globPatterns: ["_next/static/**/*.{js,css}"],
      dontCacheBustURLsMatching: /^_next\/static\//,
    },
    undefined,
  );
  const api = createApi(ctx);
  return [
    serwistMain(ctx, api),
    {
      name: "muggle:serwist-client-environment",
      apply: "build",
      applyToEnvironment: (environment) => environment.name === "client",
      closeBundle: {
        sequential: true,
        order: "post",
        async handler() {
          const outDir = path.resolve(ctx.viteConfig.root, this.environment.config.build.outDir);
          ctx.options.injectManifest.globDirectory = outDir;
          ctx.options.injectManifest.swDest = path.join(outDir, "sw.js");
          await api.generateSW();
        },
      },
    },
  ];
}

export default defineConfig({
  plugins: [vinext(), nitro(), tailwindcss(), serwistForClientEnvironment()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
});
