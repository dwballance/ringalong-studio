import { configDefaults, defineConfig } from 'vitest/config';
import base from './vite.config';

export default defineConfig({
  ...base,
  test: { ...base.test, include: ['tests/hymns.test.ts'], exclude: configDefaults.exclude },
});