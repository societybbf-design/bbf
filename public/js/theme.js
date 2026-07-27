(function initThemeManager() {
  const STORAGE_KEY = 'societyhub-theme';

  function getTheme() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') return saved;
    return 'dark';
  }

  function applyTheme(theme) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    document.documentElement.style.colorScheme = next;

    document.querySelectorAll('[data-theme-toggle]').forEach((button) => {
      const isLight = next === 'light';
      button.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
      button.setAttribute('title', isLight ? 'Switch to dark mode' : 'Switch to light mode');
      button.setAttribute('aria-pressed', isLight ? 'true' : 'false');
    });

    window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: next } }));
  }

  function toggleTheme() {
    const nextTheme = getTheme() === 'light' ? 'dark' : 'light';
    localStorage.setItem(STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
  }

  applyTheme(getTheme());

  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-theme-toggle]');
    if (!button) return;
    event.preventDefault();
    toggleTheme();
  });

  window.SocietyHubTheme = {
    get: getTheme,
    set: (theme) => {
      const next = theme === 'light' ? 'light' : 'dark';
      localStorage.setItem(STORAGE_KEY, next);
      applyTheme(next);
    },
    toggle: toggleTheme,
  };
})();
