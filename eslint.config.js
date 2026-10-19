import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

const impure = [
  { selector: "MemberExpression[object.name='Math'][property.name='random']", message: 'Use the seeded RNG (determinism).' },
  { selector: "Identifier[name='Date']", message: 'No wall-clock time in pure layers (determinism).' },
  { selector: "MemberExpression[object.name='performance']", message: 'No wall-clock time in pure layers (determinism).' },
];

export default tseslint.config(
  { ignores: ['dist', 'node_modules'] },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: { ecmaVersion: 2023, globals: { ...globals.browser, ...globals.worker } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  { files: ['src/sim/**/*.ts', 'src/content/**/*.ts'], rules: { 'no-restricted-syntax': ['error', ...impure] } },
);
