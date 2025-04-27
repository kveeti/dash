import { defineConfig } from "@rsbuild/core";
import { pluginReact } from "@rsbuild/plugin-react";
import { pluginBabel } from "@rsbuild/plugin-babel";

export default defineConfig({
	plugins: [
		pluginReact(),
		pluginBabel({
			include: /\.tsx$/,
			babelLoaderOptions(opts) {
				opts.plugins?.unshift("babel-plugin-react-compiler");
			},
		}),
	],
	server: { port: 8001, host: "0.0.0.0" },
	html: {
		template: "./src/index.html",
	},
	output: {
		polyfill: "off",
	},
	source: {
		entry: {
			index: "./src/index.tsx",
		},
	},
	tools: {
		postcss: {
			postcssOptions: {
				plugins: ["@tailwindcss/postcss"],
			},
		},
	},
});
