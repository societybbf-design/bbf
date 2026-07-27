/**
 * theme-boot.js — apply saved theme before first paint (avoids flash).
 */
(function () {
  try {
    var theme = localStorage.getItem('societyhub-theme');
    if (theme !== 'light' && theme !== 'dark') theme = 'dark';
    document.documentElement.setAttribute('data-theme', theme);
    document.documentElement.style.colorScheme = theme;
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
})();
