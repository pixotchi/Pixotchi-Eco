import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";
import reactPlugin from "eslint-plugin-react";
import reactHooksPlugin from "eslint-plugin-react-hooks";

export default [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      ".next/**",
      "build/**",
      "coverage/**",
      "node_modules/**",
      "out/**",
      "next-env.d.ts",
    ],
  },
  {
    plugins: {
      react: reactPlugin,
      "react-hooks": reactHooksPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-empty-object-type": "warn",
      "@typescript-eslint/no-require-imports": "off",
      "react/display-name": "warn",
      "react/no-unescaped-entities": "warn",
      "prefer-const": "off",
      "react-hooks/preserve-manual-memoization": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/set-state-in-effect": "off",
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },
  {
    files: ["**/*.{js,mjs,ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "@coinbase/onchainkit/minikit",
              message:
                "Use the Farcaster SDK and the shared host-environment resolver instead of OnchainKit MiniKit.",
            },
          ],
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "sdk",
          property: "context",
          message: "Use the shared host-environment resolver instead of raw sdk.context.",
        },
        {
          object: "sdk",
          property: "isInMiniApp",
          message: "Use the shared host-environment resolver instead of raw sdk.isInMiniApp().",
        },
      ],
    },
  },
  {
    files: ["lib/host-environment.tsx"],
    rules: {
      "no-restricted-properties": "off",
    },
  },
];
