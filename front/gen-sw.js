import { generateSW } from "workbox-build";

generateSW({
	sourcemap: false,
	globDirectory: "./dist",
	globPatterns: ["**/*.{js,css,ttf,html}"],
	swDest: "dist/sw.js",
	cleanupOutdatedCaches: true,
	runtimeCaching: [
		{
			urlPattern: /\/static\/.*\.(?:js|css|ttf?)$/,
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
				cacheName: "html-cache",
				expiration: {
					maxEntries: 1,
				},
			},
		},
	],
}).then(() => {
	console.log("sw generated");
});
