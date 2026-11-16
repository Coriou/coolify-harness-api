import tseslint from 'typescript-eslint';

export default tseslint.config(
  // Global ignores: generated/build output and deps are never linted.
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parser: tseslint.parser, parserOptions: { project: './tsconfig.json' } },
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  {
    // CLI presenters may write to stdout; internal logging still uses the logger.
    files: ['src/cli/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
