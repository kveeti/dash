import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react-swc";
import { defineConfig } from "vite";

export default defineConfig({
	clearScreen: false,
	server: { port: 3000 },
	preview: { port: 3000 },

	envPrefix: "PUBLIC",

	plugins: [react(), tailwindcss()],
});
