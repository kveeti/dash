export default {
	printWidth: 100,
	tabWidth: 4,
	trailingComma: "es5",
	singleQuote: false,
	semi: true,
	useTabs: true,
	plugins: ["@trivago/prettier-plugin-sort-imports", "prettier-plugin-tailwindcss"],
	importOrder: ["<THIRD_PARTY_MODULES>", "^@/(.*)$", "^[./]"],
	importOrderSeparation: true,
	importOrderSortSpecifiers: true,
};
