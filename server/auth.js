// Eenvoudige pincode-beveiliging met ondertekende sessiecookie.
// Geen externe dependencies: HMAC-ondertekening via node:crypto.
//
// Aanzetten: zet APP_PIN in je .env (bijv. APP_PIN=4821).
// Is APP_PIN niet gezet, dan is de app open (geen login vereist).

import crypto from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const COOKIE = 'av_auth';
const MAX_AGE_S = 60 * 60 * 24 * 30; // 30 dagen

export function pinRequired() {
  return Boolean(process.env.APP_PIN);
}

// Geheim voor cookie-ondertekening: uit env, anders eenmalig opslaan in data/.
function getSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  mkdirSync(dataDir, { recursive: true });
  const p = join(dataDir, '.session_secret');
  if (existsSync(p)) return readFileSync(p, 'utf8');
  const s = crypto.randomBytes(32).toString('hex');
  writeFileSync(p, s, { mode: 0o600 });
  return s;
}

function timingSafeEqualStr(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function pinMatches(pin) {
  if (!pinRequired()) return false;
  if (typeof pin !== 'string') return false;
  return timingSafeEqualStr(pin, process.env.APP_PIN);
}

function signToken() {
  const exp = Date.now() + MAX_AGE_S * 1000;
  const sig = crypto.createHmac('sha256', getSecret()).update(String(exp)).digest('hex');
  return `${exp}.${sig}`;
}

function verifyToken(token) {
  if (!token) return false;
  const [exp, sig] = token.split('.');
  if (!exp || !sig) return false;
  if (Number(exp) < Date.now()) return false;
  const expected = crypto.createHmac('sha256', getSecret()).update(exp).digest('hex');
  return timingSafeEqualStr(sig, expected);
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function isAuthed(req) {
  if (!pinRequired()) return true;
  return verifyToken(parseCookies(req)[COOKIE]);
}

export function setAuthCookie(req, res) {
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE}=${signToken()}; HttpOnly; Path=/; Max-Age=${MAX_AGE_S}; SameSite=Lax${
      secure ? '; Secure' : ''
    }`,
  );
}

export function clearAuthCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

// Middleware: blokkeert toegang als er geen geldige sessie is.
export function requireAuth(req, res, next) {
  if (isAuthed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Niet ingelogd' });
  return res.redirect('/login');
}
