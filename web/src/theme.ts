export type Theme = 'light' | 'dark';
const COOKIE_NAME = 'ringalong-theme';

export function currentTheme(): Theme {
  return document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
}

export function applyTheme(theme: Theme, remember = false): Theme {
  document.documentElement.dataset.theme = theme;
  if (remember) {
    try {
      document.cookie = `${COOKIE_NAME}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === 'https:' ? '; Secure' : ''}`;
    } catch { }
  }
  const chrome = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
  if (chrome) chrome.content = getComputedStyle(document.documentElement).getPropertyValue('--page').trim();
  return theme;
}

export function initializeTheme(): Theme {
  let saved: string | undefined;
  try { saved = document.cookie.split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE_NAME}=`))?.split('=')[1]; }
  catch { }
  const theme = saved === 'light' || saved === 'dark' ? saved :
    window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  return applyTheme(theme);
}