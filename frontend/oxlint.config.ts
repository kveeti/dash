import solid from "eslint-plugin-solid/configs/typescript";
import { defineConfig } from "oxlint";

export default defineConfig({
  jsPlugins: ["eslint-plugin-solid"],
  rules: {
    ...solid.rules,
  },
});
