const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// ============ SECURITY HEADERS ============
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), geolocation=()');
  next();
});

// ============ RATE LIMITING ============
const rateLimitMap = new Map();
function rateLimit(maxRequests, windowMs) {
  return (req, res, next) => {
    const key = req.ip + req.path;
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now - entry.start > windowMs) {
      rateLimitMap.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count++;
    if (entry.count > maxRequests) {
      return res.status(429).json({ error: 'Слишком много запросов. Подождите немного.' });
    }
    next();
  };
}
// Clean up expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap) {
    if (now - entry.start > 120000) rateLimitMap.delete(key);
  }
}, 300000);

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

// Admin credentials (use environment variables in production)
const ADMIN_LOGIN = process.env.ADMIN_LOGIN || 'romeo_skup_admin_2026';
const ADMIN_PASS = process.env.ADMIN_PASS || 'R0m3o#Skup$2026!MasterKey9x';
const ADMIN_NAME = process.env.ADMIN_NAME || 'Ромео (Администратор)';
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

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Secure session with random secret fallback
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(48).toString('hex');
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600 * 1000
  }
}));

app.set('trust proxy', 1);

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

app.post('/api/register', rateLimit(10, 60000), (req, res) => {
  const { name, login, password } = req.body || {};
  if (!name || !login || !password) return res.status(400).json({ error: 'Заполните все поля' });
  const cleanName = String(name).trim().slice(0, 50);
  const cleanLogin = String(login).trim().slice(0, 30).replace(/[^a-zA-Z0-9_а-яА-ЯёЁ]/g, '');
  if (cleanName.length < 2) return res.status(400).json({ error: 'Имя слишком короткое' });
  if (cleanLogin.length < 3) return res.status(400).json({ error: 'Логин должен быть не короче 3 символов' });
  if (String(password).length < 4 || String(password).length > 128) return res.status(400).json({ error: 'Пароль должен быть от 4 до 128 символов' });
  const exists = db.prepare('SELECT 1 FROM users WHERE login = ?').get(cleanLogin);
  if (exists) return res.status(409).json({ error: 'Этот логин уже занят' });

  const hash = bcrypt.hashSync(String(password), 12);
  const info = db.prepare('INSERT INTO users (name, login, password) VALUES (?, ?, ?)')
    .run(cleanName, cleanLogin, hash);
  const id = Number(info.lastInsertRowid);

  db.prepare('INSERT INTO messages (user_id, sender, text, type) VALUES (?, ?, ?, ?)').run(
    id, 'buyer',
    `Здравствуйте, ${cleanName}! Я ${BUYER_NAME} — скупщик Пушкинских карт. 😊 Напишите, сколько остатков на вашей карте, — сразу посчитаю сумму, которую заплатим. Можете также отправить скриншот баланса или голосовое сообщение.`,
    'text'
  );

  req.session.user = { id, name: cleanName, login: cleanLogin, role: 'user' };
  res.json({ user: req.session.user });
});

app.post('/api/login', rateLimit(15, 60000), (req, res) => {
  const { login, password } = req.body || {};
  if (!login || !password) return res.status(400).json({ error: 'Введите логин и пароль' });
  const cleanLogin = String(login).trim().slice(0, 30);
  const user = db.prepare('SELECT * FROM users WHERE login = ?').get(cleanLogin);
  if (!user || !bcrypt.compareSync(String(password), user.password)) {
    return res.status(401).json({ error: 'Неверный логин или пароль' });
  }
  // Regenerate session to prevent fixation
  req.session.regenerate(() => {
    req.session.user = { id: user.id, name: user.name, login: user.login, role: user.role };
    res.json({ user: req.session.user });
  });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

/* ============ UPLOAD API (PHOTOS & VOICE) ============ */
// Allowed MIME types whitelist
const ALLOWED_MIMES = {
  'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png',
  'image/webp': '.webp', 'image/gif': '.gif',
  'audio/webm': '.webm', 'audio/ogg': '.ogg', 'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3', 'audio/wav': '.wav', 'audio/mp4': '.m4a',
  'audio/aac': '.m4a', 'audio/x-m4a': '.m4a'
};
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 MB

app.post('/api/upload', requireAuth, rateLimit(30, 60000), (req, res) => {
  const { data } = req.body || {};
  if (!data || typeof data !== 'string') return res.status(400).json({ error: 'Нет данных файла' });

  const commaIndex = data.indexOf(',');
  if (!data.startsWith('data:') || commaIndex === -1 || commaIndex > 200) {
    return res.status(400).json({ error: 'Неверный формат данных' });
  }

  const header = data.slice(0, commaIndex);
  const base64Data = data.slice(commaIndex + 1);

  // Validate base64 content (only allow valid base64 characters)
  if (!/^[A-Za-z0-9+/=]+$/.test(base64Data.slice(0, 100))) {
    return res.status(400).json({ error: 'Повреждённые данные файла' });
  }

  const mimeMatch = header.match(/^data:([a-z]+\/[a-z0-9.+-]+)/i);
  const rawMime = mimeMatch ? mimeMatch[1].toLowerCase() : '';

  // Strip codec suffixes like audio/webm;codecs=opus -> audio/webm
  const mime = rawMime.split(';')[0];
  const ext = ALLOWED_MIMES[mime];
  if (!ext) {
    return res.status(400).json({ error: 'Недопустимый тип файла. Разрешены изображения и аудио.' });
  }

  const buffer = Buffer.from(base64Data, 'base64');
  if (buffer.length > MAX_UPLOAD_BYTES) {
    return res.status(400).json({ error: 'Файл слишком большой (макс. 8 МБ)' });
  }
  if (buffer.length < 100) {
    return res.status(400).json({ error: 'Файл слишком маленький или повреждён' });
  }

  const safeName = `media_${Date.now()}_${crypto.randomBytes(4).toString('hex')}${ext}`;
  const targetPath = path.join(uploadsDir, safeName);

  // Prevent path traversal
  if (!targetPath.startsWith(uploadsDir)) {
    return res.status(400).json({ error: 'Недопустимый путь файла' });
  }

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

const ALLOWED_MSG_TYPES = ['text', 'image', 'voice'];

app.post('/api/messages', requireAuth, rateLimit(40, 60000), (req, res) => {
  const { text = '', type = 'text', media_url = null, duration = null } = req.body || {};
  const safeType = ALLOWED_MSG_TYPES.includes(type) ? type : 'text';
  if (safeType === 'text' && (!text || !String(text).trim())) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }
  // Validate media_url: must be a local /uploads/ path
  let safeMediaUrl = null;
  if (media_url && typeof media_url === 'string') {
    if (/^\/uploads\/[a-zA-Z0-9_.-]+$/.test(media_url)) {
      safeMediaUrl = media_url;
    }
  }
  const cleanText = String(text || '').trim().slice(0, 1000);
  const safeDuration = (duration && Number.isFinite(Number(duration))) ? Math.min(Math.round(Number(duration)), 600) : null;
  const info = db.prepare('INSERT INTO messages (user_id, sender, text, type, media_url, duration) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.session.user.id, 'user', cleanText, safeType, safeMediaUrl, safeDuration);
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
  if (!Number.isFinite(userId) || userId <= 0) return res.status(400).json({ error: 'Неверный ID пользователя' });
  const { text = '', type = 'text', media_url = null, duration = null } = req.body || {};
  const safeType = ALLOWED_MSG_TYPES.includes(type) ? type : 'text';
  if (safeType === 'text' && (!text || !String(text).trim())) {
    return res.status(400).json({ error: 'Пустое сообщение' });
  }
  let safeMediaUrl = null;
  if (media_url && typeof media_url === 'string' && /^\/uploads\/[a-zA-Z0-9_.-]+$/.test(media_url)) {
    safeMediaUrl = media_url;
  }
  const cleanText = String(text || '').trim().slice(0, 1000);
  const safeDuration = (duration && Number.isFinite(Number(duration))) ? Math.min(Math.round(Number(duration)), 600) : null;
  const info = db.prepare('INSERT INTO messages (user_id, sender, text, type, media_url, duration) VALUES (?, ?, ?, ?, ?, ?)')
    .run(userId, 'buyer', cleanText, safeType, safeMediaUrl, safeDuration);
  const message = db.prepare('SELECT * FROM messages WHERE id = ?').get(Number(info.lastInsertRowid));
  res.json({ message });
});

app.listen(PORT, () => {
  console.log(`Romeo Skup запущен: http://localhost:${PORT}`);
});
