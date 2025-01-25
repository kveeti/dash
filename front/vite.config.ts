import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
	clearScreen: false,
	server: { port: 3000 },
	preview: { port: 3000 },

	envPrefix: "PUBLIC",

	plugins: [
		react({
			babel: {
				plugins: [["babel-plugin-react-compiler", {}]],
			},
		}),
		tailwindcss(),
		VitePWA({
			registerType: "prompt",
			strategies: "generateSW",
			manifest: {
				short_name: "dash",
				name: "dash",
				display: "standalone",
				start_url: ".",
				icons: [],
				// index.html has meta tags overriding this
				// for dark and light themes
				theme_color: "#000",
			},
			workbox: {
				cleanupOutdatedCaches: true,
				runtimeCaching: [
					{
						urlPattern: /\/assets\/.*\.(?:js|css|ttf?)$/,
						handler: "CacheFirst",
						options: {
							cacheName: "cache-assets",
							expiration: {
								maxEntries: 50,
								maxAgeSeconds: 7 * 24 * 60 * 60, // 1 week
							},
						},
					},
					{
						urlPattern: /^\/index\.html$/,
						handler: "NetworkFirst",
						options: {
							cacheName: "html-cache",
							expiration: {
								maxEntries: 1, // only keep the latest version
							},
						},
					},
				],
			},
		}),
	],
});
