// @ts-check

import eslint from "@eslint/js";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

/**
 * @see https://typescript-eslint.io/getting-started
 */
const eslintConfig = defineConfig(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  // https://eslint.org/docs/latest/use/configure/migration-guide#configuring-language-options
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
  },
);

export default eslintConfig;
