/**
 * Theme handling. The preference is mirrored to localStorage (UI preference
 * only, never financial data) so the correct theme applies before first paint.
 */
const KEY = 'mfp-theme';
const media = window.matchMedia('(prefers-color-scheme: dark)');

export function getThemePreference() {
  return localStorage.getItem(KEY) ?? 'system';
}

export function applyTheme(preference = getThemePreference()) {
  localStorage.setItem(KEY, preference);
  const resolved = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = resolved;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', resolved === 'dark' ? '#0B1215' : '#F4F6F8');
  return resolved;
}

media.addEventListener('change', () => {
  if (getThemePreference() === 'system') applyTheme('system');
});
