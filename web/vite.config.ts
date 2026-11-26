import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Proxy keeps the frontend on relative /api paths, so the same code works
    // in dev and when FastAPI serves the built bundle.
    proxy: {
      "/api": { target: "http://127.0.0.1:7860", changeOrigin: true },
    },
  },
});
