const crypto = require('node:crypto');

const SESSION_COOKIE = 'taller_session';
const SESSION_DAYS = 7;

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && crypto.timingSafeEqual(candidate, expected);
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

function createSession(db, userId) {
  const token = randomToken(32);
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, expires);
  return token;
}

function sessionCookie(token, { secure = false, clear = false } = {}) {
  const parts = [
    `${SESSION_COOKIE}=${clear ? '' : token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${clear ? 0 : SESSION_DAYS * 86400}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

// Attaches req.user when a valid session cookie is present.
function loadUser(db) {
  const stmt = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.active
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token = ? AND s.expires_at > ?`);
  return (req, _res, next) => {
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    if (token) {
      const user = stmt.get(token, new Date().toISOString());
      if (user && user.active) {
        req.user = user;
        req.sessionToken = token;
      }
    }
    next();
  };
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Debes iniciar sesión' });
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Debes iniciar sesión' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'No tienes permiso para esta acción' });
    next();
  };
}

module.exports = {
  hashPassword,
  verifyPassword,
  randomToken,
  createSession,
  sessionCookie,
  loadUser,
  requireAuth,
  requireRole,
};
