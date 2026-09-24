import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './') } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      exclude: [
        '.audit/**',
        '.triage/**',
        '.storybook/**',
        '.tmp*/**',
        'coverage/**',
        'dist/**',
        'node_modules/**',
        'scripts/**',
        'stories/**',
        'tests/**',
        '**/__regression__/**',
        '**/*.stories.{js,jsx,ts,tsx}',
        '**/*.config.{js,ts,mjs,cjs}',
      ],
      thresholds: { lines: 20, functions: 35, branches: 55, statements: 20 },
    },
  },
});
