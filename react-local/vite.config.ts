import { defineConfig } from "vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		react(),
		babel({ presets: [reactCompilerPreset()] }),
		tailwindcss(),
		VitePWA({
			minify: true,
			registerType: "prompt",
			injectRegister: "auto",
			strategies: "generateSW",
			devOptions: {
				enabled: true,
			},
			workbox: {
				sourcemap: false,
				cleanupOutdatedCaches: true,
				runtimeCaching: [
					{
						urlPattern: /\/assets\/.*\.(?:js|css|ttf?)$/,
						handler: "CacheFirst",
						options: {
							cacheName: "cache-assets",
							expiration: {
								maxEntries: 50,
								maxAgeSeconds: 7 * 24 * 60 * 60,
							},
						},
					},
					{
						urlPattern: /^\/index\.html$/,
						handler: "NetworkFirst",
						options: {
							cacheName: "cache-index-html",
							expiration: {
								maxEntries: 1,
							},
						},
					},
				],
			},
		}),
	],

	optimizeDeps: {
		exclude: ["@sqlite.org/sqlite-wasm"],
	},

	clearScreen: false,
	server: {
		port: 3000,
		host: true,
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
		proxy: {
			"/api": "http://localhost:8000",
		},
	},
	preview: {
		port: 3000,
		headers: {
			"Cross-Origin-Opener-Policy": "same-origin",
			"Cross-Origin-Embedder-Policy": "require-corp",
		},
		proxy: {
			"/api": "http://localhost:8000",
		},
	},
});
