// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    // Build output, not source: `expo export` writes the web bundle here.
    ignores: ['dist/*', 'expo-env.d.ts', 'nativewind-env.d.ts'],
  },
]);
