// Flat ESLint config: typescript-eslint's type-checked recommended rules
// over src/, sharing the compiler's view of the code via projectService.
import tseslint from 'typescript-eslint';

export default tseslint.config(
  ...tseslint.configs.recommendedTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      // Template literals stringify numbers throughout the UI.
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
    },
  },
  {
    // Test fakes stub DOM handlers with empty functions on purpose.
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  {
    ignores: ['dist/', 'node_modules/', 'scripts/', 'vite.config.ts'],
  },
);
