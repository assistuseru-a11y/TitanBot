// session.js
// Minimal signed-cookie session handling for the dashboard.
// Avoids adding new npm dependencies (no express-session / cookie-parser needed).
// Sessions are stored server-side in memory, keyed by a random session id that's
// stored in a signed, httpOnly cookie on the user's browser.

import crypto from 'crypto';
import { refreshAccessToken } from './discordOAuth.js';
import { logger } from '../utils/logger.js';

const COOKIE_NAME = 'titan_dash_sid';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function getSecret() {
  const secret = process.env.DASHBOARD_SESSION_SECRET || process.env.DISCORD_CLIENT_SECRET;
  if (!secret) {
    throw new Error(
      'DASHBOARD_SESSION_SECRET is not set. Set it to any long random string in your environment variables.'
    );
  }
  return secret;
}

// In-memory session store. Fine for a single bot process; if you ever run
// multiple instances behind a load balancer, swap this for Postgres/Redis.
const sessions = new Map();

function sign(value) {
  const hmac = crypto.createHmac('sha256', getSecret());
  hmac.update(value);
  return hmac.digest('hex');
}

function cleanupExpired() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (session.expiresAt < now) {
      sessions.delete(id);
    }
  }
}

setInterval(cleanupExpired, 1000 * 60 * 30).unref?.();

export function createSession(data) {
  const id = crypto.randomBytes(32).toString('hex');
  sessions.set(id, { ...data, expiresAt: Date.now() + SESSION_TTL_MS });
  return id;
}

export function getSession(id) {
  if (!id) return null;
  const session = sessions.get(id);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(id);
    return null;
  }
  return session;
}

export function updateSession(id, patch) {
  const session = sessions.get(id);
  if (!session) return null;
  Object.assign(session, patch);
  return session;
}

export function destroySession(id) {
  if (id) sessions.delete(id);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  if (!header) return {};
  return header.split(';').reduce((acc, pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return acc;
    const key = pair.slice(0, idx).trim();
    const value = decodeURIComponent(pair.slice(idx + 1).trim());
    acc[key] = value;
    return acc;
  }, {});
}

export function setSessionCookie(res, sessionId) {
  const signature = sign(sessionId);
  const cookieValue = `${sessionId}.${signature}`;
  const isProd = process.env.NODE_ENV === 'production';
  const parts = [
    `${COOKIE_NAME}=${encodeURIComponent(cookieValue)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ];
  if (isProd) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`);
}

// Express middleware: reads the session cookie, verifies the signature,
// and attaches `req.session` (or null) + `req.sessionId`.
export function sessionMiddleware(req, res, next) {
  try {
    const cookies = parseCookies(req);
    const raw = cookies[COOKIE_NAME];
    if (!raw) {
      req.session = null;
      return next();
    }

    const dotIdx = raw.lastIndexOf('.');
    if (dotIdx === -1) {
      req.session = null;
      return next();
    }

    const sessionId = raw.slice(0, dotIdx);
    const signature = raw.slice(dotIdx + 1);
    const expectedSignature = sign(sessionId);

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);
    const validSignature =
      sigBuf.length === expectedBuf.length && crypto.timingSafeEqual(sigBuf, expectedBuf);

    if (!validSignature) {
      req.session = null;
      return next();
    }

    req.sessionId = sessionId;
    req.session = getSession(sessionId);
    next();
  } catch (error) {
    logger.error('Dashboard session middleware error:', error);
    req.session = null;
    next();
  }
}

// Express middleware: blocks the request unless logged in. Also transparently
// refreshes the Discord access token if it's close to expiring, so the
// dashboard session doesn't start failing mid-week even though it lasts 7 days.
export function requireAuth(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const expiresAt = req.session.tokenExpiresAt || 0;
  const needsRefresh = expiresAt - Date.now() < 5 * 60 * 1000; // refresh if <5min left

  if (!needsRefresh || !req.session.refreshToken) {
    return next();
  }

  refreshAccessToken(req.session.refreshToken)
    .then((tokenData) => {
      updateSession(req.sessionId, {
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token || req.session.refreshToken,
        tokenExpiresAt: Date.now() + tokenData.expires_in * 1000,
      });
      req.session = getSession(req.sessionId);
      next();
    })
    .catch((error) => {
      logger.warn('Dashboard token refresh failed, forcing re-login:', error.message);
      destroySession(req.sessionId);
      clearSessionCookie(res);
      res.status(401).json({ error: 'Session expired. Please log in again.' });
    });
}
