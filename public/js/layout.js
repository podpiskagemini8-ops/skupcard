(function () {
  const path = location.pathname;
  const isChat = path.includes('chat');
  if (isChat) return;

  const links = [
    { href: '/', label: 'Главная', match: (p) => p === '/' || p === '/index.html' },
    { href: '/#how', label: 'Как это работает', match: () => false },
    { href: '/price.html', label: 'Курс', match: (p) => p.includes('price') },
    { href: '/reviews.html', label: 'Отзывы', match: (p) => p.includes('reviews') },
    { href: '/faq.html', label: 'FAQ', match: (p) => p.includes('faq') }
  ];

  const navLinks = links.map(l =>
    `<a href="${l.href}" class="${l.match(path) ? 'active' : ''}">${l.label}</a>`
  ).join('');

  const logo = `
    <a href="/" class="logo">
      <span class="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z"/></svg>
      </span>
      <span class="logo-text">ROMEO<small>SKUP</small></span>
    </a>`;

  const themePickerHtml = `
    <div class="theme-picker" id="themePicker">
      <button type="button" class="theme-btn" id="themeBtn" title="Сменить тему оформления" aria-label="Сменить тему">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>
      </button>
      <div class="theme-menu">
        <div class="theme-menu-title">Тема оформления</div>
        <button type="button" class="theme-opt" data-theme="cyberpunk">
          <span class="theme-swatch sw-cyberpunk"></span>
          <span>Неон</span>
        </button>
        <button type="button" class="theme-opt" data-theme="dark">
          <span class="theme-swatch sw-dark"></span>
          <span>Тёмная</span>
        </button>
        <button type="button" class="theme-opt" data-theme="midnight">
          <span class="theme-swatch sw-midnight"></span>
          <span>Полночь</span>
        </button>
        <button type="button" class="theme-opt" data-theme="emerald">
          <span class="theme-swatch sw-emerald"></span>
          <span>Изумруд</span>
        </button>
        <button type="button" class="theme-opt" data-theme="sunset">
          <span class="theme-swatch sw-sunset"></span>
          <span>Закат</span>
        </button>
        <button type="button" class="theme-opt" data-theme="oled">
          <span class="theme-swatch sw-oled"></span>
          <span>Глубокий OLED</span>
        </button>
      </div>
    </div>`;

  document.body.insertAdjacentHTML('afterbegin', `
    <header class="nav" id="navbar">
      <div class="nav-inner">
        ${logo}
        <nav class="nav-links" id="navLinks">${navLinks}</nav>
        <div style="display:flex;align-items:center;gap:10px;">
          ${themePickerHtml}
          <div class="nav-auth" id="navAuth"></div>
        </div>
        <button class="burger" id="burger" aria-label="Меню"><span></span><span></span><span></span></button>
      </div>
    </header>`);

  document.body.insertAdjacentHTML('beforeend', `
    <footer class="footer">
      <div class="container footer-grid">
        <div class="footer-brand">
          ${logo}
          <p>Сервис выкупа пушкинских баллов с 2021 года. Честный курс 10%, оплата после списания баллов, живой чат со скупщиком.</p>
        </div>
        <div class="footer-col">
          <h4>Навигация</h4>
          <a href="/#how">Как это работает</a>
          <a href="/price.html">Курс</a>
          <a href="/reviews.html">Отзывы</a>
          <a href="/faq.html">Вопросы и ответы</a>
        </div>
        <div class="footer-col">
          <h4>Сервис</h4>
          <a href="/chat.html">Чат со скупщиком</a>
          <a href="#" class="js-sell">Продать карту</a>
          <a href="#" class="js-login">Войти в аккаунт</a>
          <a href="#" class="js-register">Регистрация</a>
        </div>
      </div>
      <div class="footer-bottom">
        <p>© 2026 Romeo Skup. Все права защищены.</p>
        <p class="disclaimer">Демонстрационный проект. Продажа и покупка Пушкинских карт запрещена правилами программы «Пушкинская карта» и может преследоваться по закону.</p>
      </div>
    </footer>

    <div class="modal-overlay" id="authModal" aria-hidden="true">
      <div class="modal">
        <button class="modal-close" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <div class="modal-tabs">
          <button class="tab active" data-tab="login">Вход</button>
          <button class="tab" data-tab="register">Регистрация</button>
        </div>
        <form id="loginForm" class="auth-form">
          <h3>С возвращением!</h3>
          <p class="auth-sub">Войди, чтобы продолжить сделку</p>
          <label><span>Логин</span><input type="text" name="login" placeholder="Твой логин" autocomplete="username" required></label>
          <label><span>Пароль</span><input type="password" name="password" placeholder="Твой пароль" autocomplete="current-password" required></label>
          <p class="form-error" hidden></p>
          <button type="submit" class="btn btn-primary btn-block">Войти</button>
          <p class="auth-switch">Нет аккаунта? <button type="button" class="link" data-switch="register">Зарегистрируйся</button></p>
        </form>
        <form id="registerForm" class="auth-form" hidden>
          <h3>Создать аккаунт</h3>
          <p class="auth-sub">Это займёт 30 секунд</p>
          <label><span>Имя</span><input type="text" name="name" placeholder="Как к тебе обращаться" required></label>
          <label><span>Логин</span><input type="text" name="login" placeholder="Придумай логин" autocomplete="username" required></label>
          <label><span>Пароль</span><input type="password" name="password" placeholder="Минимум 4 символа" autocomplete="new-password" required></label>
          <p class="form-error" hidden></p>
          <button type="submit" class="btn btn-primary btn-block">Зарегистрироваться</button>
          <p class="auth-switch">Уже есть аккаунт? <button type="button" class="link" data-switch="login">Войди</button></p>
        </form>
      </div>
    </div>

    <div class="modal-overlay" id="reviewModal" aria-hidden="true">
      <div class="modal">
        <button class="modal-close" type="button" aria-label="Закрыть">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        <form id="reviewForm" class="auth-form">
          <h3>Оставить отзыв</h3>
          <p class="auth-sub">Расскажи, как прошла твоя сделка</p>
          <div class="star-input" id="starInput">
            <button type="button" data-star="1">★</button>
            <button type="button" data-star="2">★</button>
            <button type="button" data-star="3">★</button>
            <button type="button" data-star="4">★</button>
            <button type="button" data-star="5">★</button>
          </div>
          <label><span>Твой отзыв</span><textarea name="text" rows="4" placeholder="Поделись впечатлениями о сделке..." required></textarea></label>
          <p class="form-error" hidden></p>
          <button type="submit" class="btn btn-primary btn-block">Опубликовать отзыв</button>
        </form>
      </div>
    </div>`);
})();