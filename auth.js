const crypto = require('crypto');

const COOKIE_NAME = 'van_app_access';
const CODE = process.env.APP_ACCESS_CODE || '';

if (!CODE) {
  console.error('Missing APP_ACCESS_CODE env var — set a shared access code before deploying.');
}

function hashOf(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

const EXPECTED_TOKEN = CODE ? hashOf(CODE) : null;

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return Object.fromEntries(
    header.split(';').map(p => {
      const idx = p.indexOf('=');
      return [p.slice(0, idx).trim(), decodeURIComponent(p.slice(idx + 1).trim())];
    })
  );
}

function isAuthed(req) {
  if (!EXPECTED_TOKEN) return false;
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  if (!token || token.length !== EXPECTED_TOKEN.length) return false;
  return crypto.timingSafeEqual(Buffer.from(token), Buffer.from(EXPECTED_TOKEN));
}

// Publicly reachable paths: the login page itself, its assets, and the login API.
const PUBLIC_PATHS = new Set(['/login.html', '/api/login', '/style.css']);

function gate(req, res, next) {
  if (PUBLIC_PATHS.has(req.path)) return next();
  if (isAuthed(req)) return next();

  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Not authorized. Please enter the access code.' });
  }
  return res.redirect('/login.html');
}

function login(req, res) {
  const { code } = req.body || {};
  if (!CODE || !code || hashOf(code) !== EXPECTED_TOKEN) {
    return res.status(401).json({ error: 'Incorrect access code' });
  }
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=${EXPECTED_TOKEN}; HttpOnly; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax`);
  res.json({ ok: true });
}

module.exports = { gate, login };
