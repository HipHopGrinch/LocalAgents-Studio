import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

const recommended = tseslint.configs.recommended
  .filter(config => !config.ignores)
  .flatMap(config => Object.entries(config.rules || {}));

const warnRules = Object.fromEntries(
  recommended.map(([name, setting]) => {
    if (setting === 'off' || (Array.isArray(setting) && setting[0] === 'off')) {
      return [name, setting];
    }
    if (Array.isArray(setting)) return [name, ['warn', ...setting.slice(1)]];
    return [name, 'warn'];
  })
);

export default [
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'release/**',
      'release-*/**',
      'electron/**',
      'scripts/**',
      'coverage/**'
    ]
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true }
      }
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
      'react-hooks': reactHooks
    },
    rules: {
      ...warnRules,
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn'
    }
  }
];
