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
 * vercel), precaching the hashed `_next/static` assets found there. The build fails if that
 * finds nothing to precache.
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
          const options = ctx.options.injectManifest;
          options.globDirectory = outDir;
          options.swDest = path.join(outDir, "sw.js");
          let precacheEntries = 0;
          options.manifestTransforms = [
            ...(options.manifestTransforms ?? []),
            async (manifest) => {
              precacheEntries = manifest.length;
              return { manifest };
            },
          ];
          await api.generateSW();
          // An empty manifest means the glob missed the client assets (e.g. the outDir moved);
          // the service worker would install but cache nothing, so fail loudly instead.
          if (precacheEntries === 0) {
            throw new Error(
              `serwist: precache manifest is empty; no ${options.globPatterns?.join(", ")} under ${outDir}`,
            );
          }
        },
      },
    },
  ];
}

/**
 * Identifies one build, so data the client cached under the previous deploy is not read back
 * (see `CACHE_VERSION` in src/ui/data/resource-cache.ts). The dev server uses "dev".
 */
export function buildId(command: "build" | "serve", now: Date = new Date()): string {
  return command === "build" ? now.getTime().toString(36) : "dev";
}

export default defineConfig(({ command }) => ({
  plugins: [vinext(), nitro(), tailwindcss(), serwistForClientEnvironment()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  define: { __BUILD_ID__: JSON.stringify(buildId(command)) },
}));
