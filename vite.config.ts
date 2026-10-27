import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// base relative : l'appli fonctionne aussi bien à la racine que sous /nom-du-depot/ (GitHub Pages).
export default defineConfig({
  base: "./",
  plugins: [react()],
  worker: { format: "es" },
  optimizeDeps: { exclude: ["ocgcore-wasm"] },
});
