// authRoutes.js
import express from 'express';
import crypto from 'crypto';
import {
  getAuthorizeUrl,
  exchangeCodeForToken,
  fetchDiscordUser,
} from './discordOAuth.js';
import {
  createSession,
  setSessionCookie,
  clearSessionCookie,
  destroySession,
} from './session.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// In-memory map of OAuth `state` -> expiry, to prevent CSRF on the callback.
const pendingStates = new Map();
function makeState() {
  const state = crypto.randomBytes(16).toString('hex');
  pendingStates.set(state, Date.now() + 5 * 60 * 1000);
  return state;
}
function consumeState(state) {
  const expiry = pendingStates.get(state);
  pendingStates.delete(state);
  return !!expiry && expiry > Date.now();
}

router.get('/login', (req, res) => {
  try {
    const state = makeState();
    res.redirect(getAuthorizeUrl(state));
  } catch (error) {
    logger.error('Dashboard login error:', error);
    res.status(500).send('Dashboard is misconfigured. Check server logs.');
  }
});

router.get('/callback', async (req, res) => {
  const { code, state, error: oauthError } = req.query;

  if (oauthError) {
    return res.redirect('/dashboard?error=access_denied');
  }
  if (!code || !state || !consumeState(state)) {
    return res.redirect('/dashboard?error=invalid_state');
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    const user = await fetchDiscordUser(tokenData.access_token);

    const sessionId = createSession({
      user: { id: user.id, username: user.username, avatar: user.avatar },
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenExpiresAt: Date.now() + tokenData.expires_in * 1000,
    });

    setSessionCookie(res, sessionId);
    res.redirect('/dashboard');
  } catch (error) {
    logger.error('Dashboard OAuth callback error:', error);
    res.redirect('/dashboard?error=oauth_failed');
  }
});

router.post('/logout', (req, res) => {
  destroySession(req.sessionId);
  clearSessionCookie(res);
  res.json({ ok: true });
});

export default router;
