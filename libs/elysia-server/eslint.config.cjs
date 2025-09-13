const js = require("@eslint/js");
const tseslint = require("@typescript-eslint/eslint-plugin");
const tsparser = require("@typescript-eslint/parser");

module.exports = [
  // Base ESLint recommended rules
  js.configs.recommended,

  // TypeScript configuration
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: "module",
        project: ["./tsconfig.json", "./tsconfig.eslint.json"],
      },
      globals: {
        NodeJS: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
    },
    rules: {
      // TypeScript strict rules
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/explicit-module-boundary-types": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-type-assertion": "error",
      "@typescript-eslint/prefer-nullish-coalescing": "error",
      "@typescript-eslint/prefer-optional-chain": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "off", // False positives with interface methods
      "@typescript-eslint/no-misused-promises": "off", // Too strict for this codebase
      "@typescript-eslint/require-await": "error",
      "@typescript-eslint/no-unused-expressions": "error",
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/no-implicit-any-catch": "off", // Rule doesn't exist in current version
      "@typescript-eslint/no-unnecessary-condition": "off",
      "@typescript-eslint/no-unnecessary-qualifier": "error",
      "@typescript-eslint/no-unnecessary-type-arguments": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/prefer-string-starts-ends-with": "error",
      "@typescript-eslint/prefer-readonly": "error",
      "@typescript-eslint/promise-function-async": "off", // Too strict for interface delegation
      "@typescript-eslint/return-await": "error",
      "@typescript-eslint/strict-boolean-expressions": "off",

      // General strict rules
      "no-console": ["warn", { allow: ["error"] }],
      "no-debugger": "error",
      "no-alert": "error",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "no-script-url": "error",
      "no-sequences": "error",
      "no-throw-literal": "error",
      "no-unmodified-loop-condition": "error",
      "no-unused-labels": "error",
      "no-useless-call": "error",
      "no-useless-concat": "error",
      "no-useless-escape": "error",
      "no-useless-return": "error",
      "no-void": "error",
      "prefer-const": "error",
      "prefer-template": "error",
      "require-await": "off", // Let TypeScript handle this
      "no-var": "error",
      "object-shorthand": "error",
      "prefer-arrow-callback": "error",
      "prefer-destructuring": "error",
      "prefer-spread": "error",
      "prefer-rest-params": "error",
      "prefer-object-spread": "error",

      // Disable conflicting rules
      "no-undef": "off",
      "no-unused-vars": "off", // Let TypeScript handle this
    },
  },

  // Environment configuration
  {
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        jest: "readonly",
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        beforeEach: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        afterAll: "readonly",
      },
    },
  },
];
