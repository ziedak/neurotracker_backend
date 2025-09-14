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
      // === FOCUS ON ACTUAL BUGS ===
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/await-thenable": "error", // Re-enable this useful rule
      "@typescript-eslint/require-await": "error",

      // === PRACTICAL TYPE SAFETY ===
      "@typescript-eslint/no-explicit-any": "error", // Keep strict - any is not allowed
      "@typescript-eslint/no-non-null-assertion": "warn", // Warn for controlled use
      "@typescript-eslint/prefer-nullish-coalescing": "off",
      "@typescript-eslint/prefer-optional-chain": "error",

      // === REMOVE BUREAUCRATIC RULES ===
      // "@typescript-eslint/explicit-function-return-type": "off", // Let TypeScript infer
      // "@typescript-eslint/explicit-module-boundary-types": "off", // Trust inference

      // === KEEP USEFUL STYLE RULES ===
      "@typescript-eslint/prefer-as-const": "error",
      "@typescript-eslint/prefer-includes": "error",
      "@typescript-eslint/prefer-string-starts-ends-with": "error",

      // General strict rules
      "no-console": ["warn", { allow: ["error", "warn", "info"] }],
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
