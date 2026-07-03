import devtools from "solid-devtools/vite";
import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

export default defineConfig({
  plugins: [devtools(), solidPlugin()],
  server: {
    port: 3000,
    // The browser always talks to the backend (:8000), which reverse-proxies
    // here. Tell the HMR client to dial the proxy, not Vite directly.
    hmr: { clientPort: 8000 },
  },
  clearScreen: false,
  build: {
    // Emitted into the backend so it can be embedded into the binary.
    outDir: "../backend/webdist",
    emptyOutDir: true,
    target: "esnext",
  },
});
