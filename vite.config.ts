import { configDefaults, defineConfig } from 'vitest/config';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { hymnAdminPlugin } from './scripts/hymn-admin.mjs';

export default defineConfig({
  root: 'web',
  base: './',
  plugins: [hymnAdminPlugin(), {
    name: 'third-party-notices',
    generateBundle() {
      const dependencies = JSON.parse(readFileSync('package.json', 'utf8')).dependencies;
      const notices = Object.keys(dependencies).map(name => {
        const directory = resolve('node_modules', name);
        const license = readdirSync(directory).find(file => /^licen[cs]e(?:\.(md|txt))?$/i.test(file));
        const metadata = JSON.parse(readFileSync(resolve(directory, 'package.json'), 'utf8'));
        return `${name} ${metadata.version}\n${license ? readFileSync(resolve(directory, license), 'utf8') : metadata.license}\n`;
      });
      this.emitFile({ type: 'asset', fileName: 'THIRD_PARTY_NOTICES.txt', source: notices.join('\n\n') });
    },
  }],
  build: { outDir: '../dist', emptyOutDir: true },
  test: { include: ['tests/**/*.test.ts'], exclude: [...configDefaults.exclude, 'tests/hymns.test.ts'], environment: 'jsdom' },
});