import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, currentTheme, initializeTheme } from '../src/theme';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';

describe('theme preference', () => {
  afterEach(() => {
    document.cookie = 'ringalong-theme=; Max-Age=0; Path=/';
    delete document.documentElement.dataset.theme;
    vi.unstubAllGlobals();
  });
  it('remembers explicit choices in a browser cookie', () => {
    applyTheme('dark', true);
    expect(document.cookie).toContain('ringalong-theme=dark');
    expect(initializeTheme()).toBe('dark');
    applyTheme('light', true);
    expect(currentTheme()).toBe('light');
    expect(document.cookie).toContain('ringalong-theme=light');
  });
  it('uses the system preference before a theme is chosen', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(initializeTheme()).toBe('dark');
    expect(document.cookie).not.toContain('ringalong-theme');
  });
  it('honors a light cookie even when the system is dark', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    document.cookie = 'ringalong-theme=light; Path=/';
    expect(initializeTheme()).toBe('light');
  });
  it('ignores malformed cookie values', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    document.cookie = 'ringalong-theme=invalid; Path=/';
    expect(initializeTheme()).toBe('light');
  });
  it('defines matching theme tokens and keeps all color literals inside the palettes', () => {
    const root = resolve(import.meta.dirname, '../src');
    const theme = postcss.parse(readFileSync(resolve(root, 'theme.css'), 'utf8'));
    const light = new Set<string>(), dark = new Set<string>();
    theme.walkRules(rule => {
      rule.walkDecls(declaration => {
        if (declaration.prop.startsWith('--')) (rule.selector.includes('dark') ? dark : light).add(declaration.prop);
      });
    });
    expect([...dark].sort()).toEqual([...light].sort());
    const references = new Set<string>();
    for (const filename of ['styles.css', 'score.css']) {
      const css = postcss.parse(readFileSync(resolve(root, filename), 'utf8'));
      css.walkDecls(declaration => {
        expect(declaration.prop.startsWith('--'), `${filename}: theme definitions belong in theme.css`).toBe(false);
        const literalValue = declaration.value.replace(/var\(--[\w-]+\)/g, '');
        expect(literalValue, `${filename}: ${declaration.prop}`).not.toMatch(/#[\da-f]{3,8}\b|\b(?:white|black|transparent)\b/i);
        expect(declaration.value).not.toContain('var(--var(');
        for (const match of declaration.value.matchAll(/var\((--[\w-]+)/g)) references.add(match[1]);
      });
    }
    for (const reference of references) expect(light.has(reference) || ['--bell', '--bell-ink', '--mark'].includes(reference), `${reference} needs both themes`).toBe(true);
  });
});