import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    coverage: {
      reporter: ['text', 'html'],
      include: ['electron/proxy/**/*.ts'],
    },
  },
  resolve: {
    alias: {
      '@electron': path.resolve(__dirname, 'electron'),
    },
  },
});
