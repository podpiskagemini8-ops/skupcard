/* ============ UTILS ============ */
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Что-то пошло не так');
  return data;
}

/* ============ AUTH STATE ============ */
let currentUser = null;

async function loadAuth() {
  try {
    const { user } = await api('/api/me');
    currentUser = user;
  } catch (e) {
    currentUser = null;
  }
  renderAuth();
}

function renderAuth() {
  const box = $('#navAuth');
  if (!box) return;
  if (currentUser) {
    const isAdmin = currentUser.role === 'admin';
    const mainActionBtn = isAdmin
      ? `<a href="/admin.html" class="btn btn-primary btn-sm">Панель Ромео</a>`
      : `<a href="/chat.html" class="btn btn-primary btn-sm">Чат со скупщиком</a>`;

    box.innerHTML = `
      <div class="nav-user" title="${currentUser.name}">
        <span class="nu-avatar">${avatarLetter(currentUser.name)}</span>
        <span class="nu-name">${escapeHtml(currentUser.name)}</span>
      </div>
      ${mainActionBtn}
      <button class="btn btn-ghost btn-sm" id="logoutBtn">Выйти</button>`;
    $('#logoutBtn').addEventListener('click', async () => {
      await api('/api/logout', { method: 'POST' });
      currentUser = null;
      renderAuth();
      toast('Вы вышли из аккаунта');
    });
  } else {
    box.innerHTML = `
      <button class="btn btn-ghost btn-sm js-login">Войти</button>
      <button class="btn btn-primary btn-sm js-register">Регистрация</button>`;
    $$('.js-login', box).forEach(b => b.addEventListener('click', () => openAuth('login')));
    $$('.js-register', box).forEach(b => b.addEventListener('click', () => openAuth('register')));
  }
}

function avatarLetter(name) {
  return (name || '?').trim().charAt(0).toUpperCase();
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

/* ============ MODALS ============ */
function getModalEl(target) {
  if (!target) return null;
  if (typeof target !== 'string') return target;
  if (target.startsWith('#') || target.startsWith('.')) return $(target);
  return document.getElementById(target) || $(`#${target}`);
}

function openModal(id) {
  const el = getModalEl(id);
  if (!el) return;
  el.classList.add('open');
  el.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  const el = getModalEl(id);
  if (!el) return;
  el.classList.remove('open');
  el.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
}

function openAuth(tab) {
  openModal('#authModal');
  switchTab(tab);
}
function switchTab(tab) {
  $$('#authModal .tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  $('#loginForm').hidden = tab !== 'login';
  $('#registerForm').hidden = tab !== 'register';
}

/* ============ AUTH FORMS ============ */
function bindAuthForm(formId, endpoint, onSuccess) {
  $(formId).addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $(formId + ' .form-error');
    const btn = $(formId + ' button[type=submit]');
    const data = Object.fromEntries(new FormData(e.target).entries());
    err.hidden = true;
    btn.disabled = true;
    try {
      const { user } = await api(endpoint, {
        method: 'POST',
        body: JSON.stringify(data)
      });
      currentUser = user;
      closeModal('#authModal');
      renderAuth();
      if (user && user.role === 'admin') {
        location.href = '/admin.html';
        return;
      }
      onSuccess && onSuccess(user);
      toast(endpoint === '/api/register' ? 'Аккаунт создан! Добро пожаловать!' : 'С возвращением!');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}

/* ============ TOAST ============ */
function toast(text) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 3200);
}

/* ============ REVIEWS ============ */
async function loadReviews() {
  if (!$('#reviewsGrid')) return;
  try {
    const { reviews } = await api('/api/reviews');
    renderReviews(reviews);
  } catch (e) { /* молча */ }
}

function renderReviews(reviews) {
  const grid = $('#reviewsGrid');
  grid.innerHTML = reviews.map(r => `
    <article class="review-card">
      <div class="review-stars">${stars(r.rating)}</div>
      <p class="review-text">${escapeHtml(r.text)}</p>
      <div class="review-meta">
        <div class="review-author">
          <span class="ra-avatar">${avatarLetter(r.author)}</span>
          <div>
            <strong>${escapeHtml(r.author)}</strong>
            <span>${relativeDate(r.created_at)}</span>
          </div>
        </div>
        <span class="review-verified">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>
          сделка подтверждена
        </span>
      </div>
    </article>
  `).join('');
  grid.querySelectorAll('.review-card').forEach((c, i) => {
    c.style.animation = `msgIn .5s ease ${Math.min(i * 0.06, 0.5)}s both`;
  });
}

function stars(n) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += `<span class="${i <= n ? '' : 'off'}">★</span>`;
  return s;
}

function relativeDate(iso) {
  const d = new Date(iso);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 30) return `${days} дн. назад`;
  const m = Math.floor(days / 30);
  if (m === 1) return 'месяц назад';
  return `${m} мес. назад`;
}

/* ============ REVIEW MODAL ============ */
let reviewRating = 5;
let reviewFormUser = null;

async function ensureAuthForReview() {
  if (currentUser) { reviewFormUser = currentUser; return true; }
  openAuth('login');
  return false;
}

function bindReviewModal() {
  const btn = $('#addReviewBtn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    if (await ensureAuthForReview()) {
      $('#reviewModal .form-error').hidden = true;
      $('#reviewForm').reset();
      reviewRating = 5;
      paintStars();
      openModal('#reviewModal');
    }
  });

  const starBtns = $$('#starInput button');
  starBtns.forEach(b => b.addEventListener('click', () => {
    reviewRating = Number(b.dataset.star);
    paintStars();
  }));
  function paintStars() {
    starBtns.forEach(b => b.classList.toggle('on', Number(b.dataset.star) <= reviewRating));
  }

  $('#reviewForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = $('#reviewForm .form-error');
    const btn = $('#reviewForm button[type=submit]');
    const text = $('#reviewForm textarea').value.trim();
    err.hidden = true;
    btn.disabled = true;
    try {
      const { review } = await api('/api/reviews', {
        method: 'POST',
        body: JSON.stringify({ rating: reviewRating, text })
      });
      closeModal('#reviewModal');
      loadReviews();
      toast('Спасибо за отзыв!');
    } catch (ex) {
      err.textContent = ex.message;
      err.hidden = false;
    } finally {
      btn.disabled = false;
    }
  });
}

/* ============ EFFECTS ============ */
function initTilt() {
  const fine = window.matchMedia('(pointer: fine)').matches;
  if (!fine) return;
  $$('[data-tilt]').forEach(el => {
    el.addEventListener('mousemove', (e) => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5;
      const y = (e.clientY - r.top) / r.height - 0.5;
      el.style.transform = `perspective(900px) rotateY(${x * 10}deg) rotateX(${-y * 10}deg)`;
    });
    el.addEventListener('mouseleave', () => {
      el.style.transform = 'perspective(900px) rotateY(0deg) rotateX(0deg)';
    });
  });
}

function initCounters() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (!en.isIntersecting) return;
      const el = en.target;
      io.unobserve(el);
      const target = parseFloat(el.dataset.count);
      const dec = parseInt(el.dataset.decimals || 0, 10);
      const suf = el.dataset.suffix || '';
      const t0 = performance.now();
      const dur = 1400;
      const tick = (t) => {
        const p = Math.min((t - t0) / dur, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        el.textContent = (target * eased).toFixed(dec).replace('.', ',') + suf;
        if (p < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, { threshold: 0.5 });
  $$('[data-count]').forEach(el => io.observe(el));
}

/* ============ NAV / SCROLL / REVEAL ============ */
function bindNav() {
  const nav = $('#navbar');
  const onScroll = () => nav && nav.classList.toggle('scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const burger = $('#burger');
  const navLinks = $('#navLinks');
  if (burger && navLinks) {
    burger.addEventListener('click', () => {
      const isOpen = burger.classList.toggle('open');
      navLinks.classList.toggle('open', isOpen);
      document.body.style.overflow = isOpen ? 'hidden' : '';
    });
    $$('#navLinks a').forEach(a => a.addEventListener('click', () => {
      burger.classList.remove('open');
      navLinks.classList.remove('open');
      document.body.style.overflow = '';
    }));
  }

  document.addEventListener('click', (e) => {
    const t = e.target.closest('.js-login, .js-register, .js-sell, .js-chat');
    if (!t) return;
    if (burger && navLinks && navLinks.classList.contains('open')) {
      burger.classList.remove('open');
      navLinks.classList.remove('open');
      document.body.style.overflow = '';
    }
    e.preventDefault();
    if (t.classList.contains('js-sell') || t.classList.contains('js-chat')) {
      if (currentUser) {
        location.href = currentUser.role === 'admin' ? '/admin.html' : '/chat.html';
        return;
      }
      openAuth(t.classList.contains('js-sell') ? 'register' : 'login');
    } else if (t.classList.contains('js-login')) {
      openAuth('login');
    } else {
      openAuth('register');
    }
  });
}

function bindReveal() {
  const io = new IntersectionObserver(entries => {
    entries.forEach(en => {
      if (en.isIntersecting) {
        en.target.classList.add('visible');
        io.unobserve(en.target);
      }
    });
  }, { threshold: 0.12 });
  $$('.reveal').forEach(el => io.observe(el));
}

/* ============ INIT ============ */
document.addEventListener('DOMContentLoaded', async () => {
  bindNav();
  bindReveal();
  initTilt();
  initCounters();
  bindReviewModal();
  bindAuthForm('#loginForm', '/api/login');
  bindAuthForm('#registerForm', '/api/register', () => {
    if (location.pathname.includes('chat')) location.reload();
  });

  $$('.modal-close').forEach(b =>
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      closeModal(b.closest('.modal-overlay'));
    })
  );
  ['#authModal', '#reviewModal'].forEach(id => {
    const overlay = $(id);
    if (overlay) {
      overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(overlay); });
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { ['#authModal', '#reviewModal'].forEach(id => closeModal(id)); }
  });

  $$('#authModal .tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
  $$('#authModal [data-switch]').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.switch)));

  await loadAuth();
  loadReviews();

  if (location.hash === '#auth=login') openAuth('login');
  if (location.hash === '#auth=register') openAuth('register');
});