import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
  ],
  server: {
    port: Number(process.env.VITE_PORT ?? 3000),
    // The browser talks to the backend, which reverse-proxies Vite.
    hmr: {
      clientPort: Number(
        process.env.VITE_HMR_CLIENT_PORT ?? process.env.PORT ?? 8000,
      ),
    },
  },
  clearScreen: false,
  build: {
    // Emitted into the backend so it can be embedded into the binary.
    outDir: "../backend/webdist",
    emptyOutDir: true,
    target: "esnext",
  },
});
