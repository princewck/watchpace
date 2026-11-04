export default [
  {
    files: ["src/**/*.mjs", "node-runtime/**/*.mjs", "test/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: Object.fromEntries(
        [
          "Request", "Response", "Headers", "fetch", "AbortSignal", "crypto",
          "console", "Buffer", "process", "setInterval", "clearInterval",
          "setTimeout", "clearTimeout", "performance", "TextEncoder",
          "TextDecoder", "URL", "structuredClone",
        ].map((name) => [name, "readonly"]),
      ),
    },
    rules: { "no-undef": "error" },
  },
];
