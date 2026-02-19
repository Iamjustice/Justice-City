import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { metaImagesPlugin } from "./vite-plugin-meta-images";

function shouldShowRuntimeOverlay(error: Error): boolean {
  const message = error.message ?? "";
  const stack = error.stack ?? "";
  const errorText = `${message}\n${stack}`;

  // Ignore browser extension runtime errors (e.g. MetaMask) in local dev.
  return !/(chrome|moz|safari)-extension:\/\//i.test(errorText);
}

const isProductionBuild = process.env.NODE_ENV === "production";

export default defineConfig({
  plugins: [
    react(),
    ...(isProductionBuild
      ? []
      : [runtimeErrorOverlay({ filter: shouldShowRuntimeOverlay })]),
    tailwindcss(),
    metaImagesPlugin(),
    ...(!isProductionBuild &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  css: {
    postcss: {
      plugins: [],
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      // Lower parallel file operations to reduce EMFILE risk on constrained CI hosts.
      maxParallelFileOps: 64,
    },
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
});
