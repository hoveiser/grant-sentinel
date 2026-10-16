import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Base path matches the GitHub Pages project site:
// https://hoveiser.github.io/grant-sentinel/
export default defineConfig({
  base: "/grant-sentinel/",
  plugins: [react()],
  server: {
    port: 5173,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
