import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';
import noUnsanitized from 'eslint-plugin-no-unsanitized';

// Obsidian conventions apply to its desktop runtime, not the independent web app.
// Keep the review's type and security checks repeatable with the correct TS project.
export default defineConfig([
  {
    files: ['packages/obsidian/src/**/*.ts'],
    languageOptions: { parser: tseslint.parser, parserOptions: { project: './packages/obsidian/tsconfig.json', tsconfigRootDir: import.meta.dirname } },
    plugins: { '@typescript-eslint': tseslint.plugin, obsidianmd, 'no-unsanitized': noUnsanitized },
    rules: {
      ...Object.fromEntries(['no-explicit-any', 'no-unsafe-assignment', 'no-unsafe-member-access', 'no-unsafe-call', 'no-unsafe-argument', 'no-unsafe-return', 'no-unnecessary-type-assertion', 'no-require-imports', 'no-misused-promises', 'unbound-method'].map(name => [`@typescript-eslint/${name}`, 'error'])),
      ...Object.fromEntries(['prefer-window-timers', 'prefer-create-el', 'no-global-this', 'settings-tab/prefer-setting-definitions', 'settings-tab/no-deprecated-display', 'no-forbidden-elements', 'regex-lookbehind'].map(name => [`obsidianmd/${name}`, 'error'])),
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-unsanitized/property': 'error',
      'no-unsanitized/method': 'error',
    },
  },
  {
    files: ['public/*.js', 'src/lib/*.{ts,js}'],
    languageOptions: { parser: tseslint.parser },
    plugins: { 'no-unsanitized': noUnsanitized },
    rules: { 'no-eval': 'error', 'no-implied-eval': 'error', 'no-unsanitized/property': 'error', 'no-unsanitized/method': 'error' },
  },
]);
