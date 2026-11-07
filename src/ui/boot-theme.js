// Runs synchronously in <head> to apply the saved theme before first paint (avoids a flash).
(function () {
  try {
    var pref = localStorage.getItem('mfp-theme') || 'system';
    var dark = pref === 'dark' || (pref === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  } catch (e) {
    document.documentElement.dataset.theme = 'light';
  }
})();
