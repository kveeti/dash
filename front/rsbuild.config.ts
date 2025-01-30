import { defineConfig, loadEnv } from "@rsbuild/core";
import { pluginBabel } from "@rsbuild/plugin-babel";
import { pluginReact } from "@rsbuild/plugin-react";

const { publicVars } = loadEnv({ prefixes: ["PUBLIC_"] });

export default defineConfig({
	plugins: [
		pluginReact(),
		pluginBabel({
			include: /\.(?:jsx|tsx)$/,
			babelLoaderOptions(opts) {
				opts.plugins?.unshift("babel-plugin-react-compiler");
			},
		}),
	],
	server: { port: 3000, host: "0.0.0.0" },

	html: {
		template: "./index.html",
	},
	source: {
		define: publicVars,
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
