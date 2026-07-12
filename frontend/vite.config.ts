import devtools from "solid-devtools/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [devtools(), solidPlugin()],
  server: {
    port: Number(process.env.VITE_PORT ?? 3000),
    // The browser talks to the backend, which reverse-proxies Vite.
    hmr: { clientPort: Number(process.env.PORT ?? 8000) },
  },
  clearScreen: false,
  build: {
    // Emitted into the backend so it can be embedded into the binary.
    outDir: "../backend/webdist",
    emptyOutDir: true,
    target: "esnext",
  },
});
