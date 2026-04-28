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
      ".claude/**",
      "build/**",
      "C:/**",
      "contracts/**",
      "coverage/**",
      "node_modules/**",
      "out/**",
      "exports/**",
      "pixotchi-onchain/**",
      "public/abi/**",
      "tools/**",
      "v22/**",
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
      "react-hooks/rules-of-hooks": "warn",
      "react-hooks/exhaustive-deps": "warn",
      // The React Compiler lint rules can consume multiple GB on complex transaction components.
      // Keep the proven hooks rules on, but avoid the compiler pass until the codebase is compiler-ready.
      "react-hooks/config": "off",
      "react-hooks/error-boundaries": "off",
      "react-hooks/gating": "off",
      "react-hooks/globals": "off",
      "react-hooks/immutability": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "react-hooks/purity": "off",
      "react-hooks/refs": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/set-state-in-render": "off",
      "react-hooks/static-components": "off",
      "react-hooks/unsupported-syntax": "off",
      "react-hooks/use-memo": "off",
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
