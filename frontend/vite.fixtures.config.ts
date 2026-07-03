import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";

// Standalone server for the Playwright fixtures
export default defineConfig({
  root: "e2e/fixtures",
  plugins: [solidPlugin()],
});
