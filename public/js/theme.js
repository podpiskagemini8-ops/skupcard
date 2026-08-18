/* ============ ROMEO THEME CONTROLLER ============ */
(function() {
  const THEME_KEY = 'romeo_theme';
  const DEFAULT_THEME = 'cyberpunk';

  let savedTheme = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
  if (savedTheme === 'light') {
    savedTheme = DEFAULT_THEME;
    localStorage.setItem(THEME_KEY, DEFAULT_THEME);
  }
  document.documentElement.setAttribute('data-theme', savedTheme);

  window.setRomeoTheme = function(themeId) {
    document.documentElement.setAttribute('data-theme', themeId);
    localStorage.setItem(THEME_KEY, themeId);
    updateThemeMenuState(themeId);
  };

  function updateThemeMenuState(activeTheme) {
    document.querySelectorAll('.theme-opt').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.theme === activeTheme);
    });
  }

  window.initThemePicker = function() {
    const curTheme = localStorage.getItem(THEME_KEY) || DEFAULT_THEME;
    updateThemeMenuState(curTheme);

    document.querySelectorAll('.theme-picker').forEach(picker => {
      if (picker._bound) return;
      picker._bound = true;

      const btn = picker.querySelector('.theme-btn');
      const menu = picker.querySelector('.theme-menu');
      if (!btn || !menu) return;

      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const isOpen = menu.classList.toggle('open');
        // Close any other open theme menus
        document.querySelectorAll('.theme-menu').forEach(m => {
          if (m !== menu) m.classList.remove('open');
        });
      });

      menu.querySelectorAll('.theme-opt').forEach(opt => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          const t = opt.dataset.theme;
          window.setRomeoTheme(t);
          menu.classList.remove('open');
        });
      });
    });

    document.addEventListener('click', () => {
      document.querySelectorAll('.theme-menu.open').forEach(m => m.classList.remove('open'));
    });
  };

  document.addEventListener('DOMContentLoaded', window.initThemePicker);
})();
