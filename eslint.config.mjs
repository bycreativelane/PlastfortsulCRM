import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Vendored minified opus-recorder encoder worker (served statically).
    "public/opus/**",
    // Design source, not application code: the static HTML/CSS/JS
    // prototype and its node scripts. It has its own conventions (no
    // build, CommonJS, no TypeScript) and lints as a wall of errors
    // under the app's config. Kept in-repo so the interface it
    // specifies stays next to the interface that implements it.
    "plastfortsul-crm/**",
  ]),
]);

export default eslintConfig;
