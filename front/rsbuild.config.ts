import { defineConfig } from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";
import { pluginReact } from "@rsbuild/plugin-react";

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
	server: { port: 33000, host: "0.0.0.0" },
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
