const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Universal SQLite database connection (supports Node 18, 20, 22, 24+)
let db;
try {
  const Database = require('better-sqlite3');
  db = new Database(path.join(__dirname, 'data.db'));
} catch (e1) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(path.join(__dirname, 'data.db'));
  } catch (e2) {
    console.error('Ошибка подключения к SQLite базе данных:', e2);
  }
}

// Initialize database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    login TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    sender TEXT NOT NULL,
    text TEXT DEFAULT '',
    type TEXT NOT NULL DEFAULT 'text',
    media_url TEXT,
    duration INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    author TEXT NOT NULL,
    rating INTEGER NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// Migrations if columns were missing
try { db.exec("ALTER TABLE messages ADD COLUMN type TEXT NOT NULL DEFAULT 'text';"); } catch (e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN media_url TEXT;"); } catch (e) {}
try { db.exec("ALTER TABLE messages ADD COLUMN duration INTEGER;"); } catch (e) {}

// Admin credentials
const ADMIN_LOGIN = 'romeo_skup_admin_2026';
const ADMIN_PASS = 'R0m3o#Skup$2026!MasterKey9x';
const ADMIN_NAME = 'Ромео (Администратор)';
const BUYER_NAME = 'Ромео';

const adminUser = db.prepare('SELECT * FROM users WHERE login = ?').get(ADMIN_LOGIN);
if (!adminUser) {
  const hash = bcrypt.hashSync(ADMIN_PASS, 10);
  db.prepare('INSERT INTO users (name, login, password, role) VALUES (?, ?, ?, ?)').run(
    ADMIN_NAME,
    ADMIN_LOGIN,
    hash,
    'admin'
  );
}

// Seed reviews if empty
const reviewCount = db.prepare('SELECT COUNT(*) AS c FROM reviews').get().c;
if (reviewCount === 0) {
  const insert = db.prepare('INSERT INTO reviews (author, rating, text, created_at) VALUES (?, ?, ?, ?)');
  const now = Date.now();
  const daysAgo = [2, 3, 5, 7, 9, 14, 16, 21];
  const seeds = [
    ['Дмитрий К.', 5, 'Продал карту за 20 минут. Остаток был 3 500 ₽, получил 2 450 ₽ на карту. Ромео всё объяснил спокойно, никаких лишних вопросов.'],
    ['Анастасия', 5, 'Сначала очень боялась, что обманут. Но всё прошло честно: показала остаток, через 5 минут деньги уже были на СБП. Рекомендую!'],
    ['Артём', 5, 'Чат отвечает мгновенно, скупщик вежливый и по делу. Продал карту за один вечер, без нервов.'],
    ['Софья В.', 5, 'Всё прозрачно: называешь остаток — тебе сразу называют сумму. Никаких скрытых комиссий. Спасибо, Ромео!'],
    ['Максим', 5, 'Это уже вторая моя сделка с Ромео. Один раз он был на связи даже ночью — редкость в этом деле.'],
    ['Полина', 4, 'Всё супер, деньги пришли за 10 минут. Снимаю звезду только за то, что в первый раз было волнительно, но в итоге всё отлично.'],
    ['Егор', 5, 'Быстро, честно, без лишних разговоров. Показал остаток — получил 70%. Всем советую.'],
    ['Мария', 5, 'Можно сделать всё онлайн, даже выходить из дома не пришлось. Деньги пришли моментально, как и обещали.']
  ];
  seeds.forEach((s, i) => {
    insert.run(s[0], s[1], s[2], new Date(now - daysAgo[i] * 86400000).toISOString());
  });
}

app.use(express.json({ limit: '25mb' }));
app.use(express.urlencoded({ extended: true, limit: '25mb' }));

app.use(session({
  secret: 'romeo-skup-secret-key-2026',
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, maxAge: 7 * 24 * 3600 * 1000 }
}));

app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// Explicit clean page routing
app.get(['/', '/index'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get(['/chat', '/chat.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));
app.get(['/admin', '/admin.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get(['/price', '/price.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'price.html')));
app.get(['/reviews', '/reviews.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'reviews.html')));
app.get(['/faq', '/faq.html'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'faq.html')));

const requireAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Войдите в аккаунт' });
  next();
};

const requireAdmin = (req, res, next) => {
  if (!req.session.user || req.session.user.role !== 'admin') {
    return res.status(403).json({ error: 'Доступ запрещён. Требуются права администратора.' });
  }
  next();
};

/* ============ AUTH APIS ============ */
app.get('/api/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Не авторизован' });
  res.json({ user: req.session.user });
});

app.post('/api/register', (req, res) => {
  const { name, login, password } = req.body || {};
  if (!name || !login || !password) return res.status(400).json({ error: 'Заполните все поля' });
  if (name.trim().length < 2) return res.status(400).json({ error: 'Имя слишком короткое' });
  if (login.trim().length < 3) return res.status(400).json({ error: 'Логин должен быть не короче 3 символов' });
  if (password.length < 4) return res.status(400).json({ error: 'Пароль должен быть не короче 4 символов' });
  const exists = db.prepare('SELECT 1 FROM users WHERE login = ?').get(login.trim());
  if (exists) return res.status(409).json({ error: 'Этот логин уже занят' });

  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (name, login, password) VALUES (?, ?, ?)')
    .run(name.trim(), login.trim(), hash);
  const id = Number(info.lastInsertRowid);

  db.prepare('INSERT INTO messages (user_id, sender, text, type) VALUES (?, ?, ?, ?)').run(
    id, 'buyer',
    `Здравствуйте, ${name.trim()}! Я ${BUYER_NAME} — скупщик Пушкинских карт. 😊 Напишите, сколько остатков на вашей карте, — сразу посчитаю сумму, которую заплатим. Можете также отправить скриншот баланса или голосовое сообщение.`,
    'text'
  );

  req.session.user = { id, name: name.trim(), login: login.trim(), role: 'user' };
  res.json({ user: req.session.user });
});

app.post('/api/login', (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(login.trim());
  if (!user || !bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  req.session.user = { id: user.id, name: user.name, login: user.login, role: user.role };
  res.json({ user: req.session.user });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/* ============ UPLOAD API (PHOTOS & VOICE) ============ */
app.post('/api/upload', requireAuth, (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== 'string') return res.status(400).json({ error: 'Нет данных файла' });

  const commaIndex = data.indexOf(',');
  if (!data.startsWith('data:') || commaIndex === -1) {
    return res.status(400).json({ error: 'Неверный формат данных' });
  }

  const header = data.slice(0, commaIndex); // e.g. "data:audio/webm;codecs=opus;base64"
  const base64Data = data.slice(commaIndex + 1);
  const mimeMatch = header.match(/^data:([^;]+)/);
  const mime = mimeMatch ? mimeMatch[1].toLowerCase() : 'application/octet-stream';
  const buffer = Buffer.from(base64Data, 'base64');

  let ext = '.bin';
  if (mime.includes('jpeg') || mime.includes('jpg')) ext = '.jpg';
  else if (mime.includes('png')) ext = '.png';
  else if (mime.includes('webp')) ext = '.webp';
  else if (mime.includes('gif')) ext = '.gif';
  else if (mime.includes('webm')) ext = '.webm';
  else if (mime.includes('ogg')) ext = '.ogg';
  else if (mime.includes('mp3') || mime.includes('mpeg')) ext = '.mp3';
  else if (mime.includes('wav')) ext = '.wav';
  else if (mime.includes('mp4') || mime.includes('m4a') || mime.includes('aac')) ext = '.m4a';
  else if (mime.startsWith('image/')) ext = '.jpg';
  else if (mime.startsWith('audio/')) ext = '.webm';

  const safeName = `media_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`;
  const targetPath = path.join(uploadsDir, safeName);

  fs.writeFileSync(targetPath, buffer);
  res.json({ url: `/uploads/${safeName}`, mime });
});

/* ============ REVIEWS ============ */
app.get('/api/reviews', (req, res) => {
  const reviews = db.prepare('SELECT * FROM reviews ORDER BY id DESC LIMIT 12').all();
  res.json({ reviews });
});

app.post('/api/reviews', requireAuth, (req, res) => {
  const { rating, text } = req.body || {};
  const r = Number(rating);
  if (!text || !text.trim()) return res.status(400).json({ error: 'Напишите текст отзыва' });
  if (!Number.isInteger(r) || r < 1 || r > 5) return res.status(400).json({ error: 'Поставьте оценку от 1 до 5' });
  const info = db.prepare('INSERT INTO reviews (user_id, author, rating, text) VALUES (?, ?, ?, ?)')
    .run(req.session.user.id, req.session.user.name, r, text.trim());
  const review = db.prepare('SELECT * FROM reviews WHERE id = ?').get(Number(info.lastInsertRowid));
  res.json({ review });
});

/* ============ USER MESSAGES ============ */
app.get('/api/messages', requireAuth, (req, res) => {
  const messages = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY id ASC')
    .all(req.session.user.id);
  res.json({ messages, buyer: { name: BUYER_NAME } });
});

app.post('/api/messages', requireAuth, (req, res) => {
  const { text = '', type = 'text', media_url = null, duration = null } = req.body || {};
  if (type === 'text' && (!text || !text.trim())) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }
  const cleanText = (text || '').trim().slice(0, 1000);
  const info = db.prepare('INSERT INTO messages (user_id, sender, text, type, media_url, duration) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.session.user.id, 'user', cleanText, type, media_url, duration ? Math.round(duration) : null);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid));
  res.json({ message });
});

/* ============ ADMIN CHATS APIS ============ */
app.get('/api/admin/chats', requireAdmin, (req, res) => {
  const chats = db.prepare(`
    SELECT u.id, u.name, u.login, u.created_at,
           (SELECT text FROM messages WHERE user_id = u.id ORDER BY id DESC LIMIT 1) as last_message,
           (SELECT type FROM messages WHERE user_id = u.id ORDER BY id DESC LIMIT 1) as last_type,
           (SELECT created_at FROM messages WHERE user_id = u.id ORDER BY id DESC LIMIT 1) as last_message_time,
           (SELECT sender FROM messages WHERE user_id = u.id ORDER BY id DESC LIMIT 1) as last_sender,
           (SELECT COUNT(*) FROM messages WHERE user_id = u.id) as total_messages
    FROM users u
    WHERE u.role != 'admin'
    ORDER BY COALESCE(last_message_time, u.created_at) DESC
  `).all();
  res.json({ chats });
});

app.get('/api/admin/chats/:userId/messages', requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const clientUser = db.prepare('SELECT id, name, login, role, created_at FROM users WHERE id = ?').get(userId);
  if (!clientUser) return res.status(404).json({ error: 'Клиент не найден' });
  const messages = db.prepare('SELECT * FROM messages WHERE user_id = ? ORDER BY id ASC').all(userId);
  res.json({ user: clientUser, messages });
});

app.post('/api/admin/chats/:userId/messages', requireAdmin, (req, res) => {
  const userId = Number(req.params.userId);
  const { text = '', type = 'text', media_url = null, duration = null } = req.body || {};
  if (type === 'text' && (!text || !text.trim())) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }
  const cleanText = (text || '').trim().slice(0, 1000);
  const info = db.prepare('INSERT INTO messages (user_id, sender, text, type, media_url, duration) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, 'buyer', cleanText, type, media_url, duration ? Math.round(duration) : null);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid));
  res.json({ message });
});

app.listen(PORT, () => {
  console.log(`Romeo Skup запущен: http://localhost:${PORT}`);
});
