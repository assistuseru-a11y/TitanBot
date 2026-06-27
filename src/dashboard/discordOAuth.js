// discordOAuth.js
// Thin wrapper around Discord's OAuth2 endpoints, used only by the dashboard.
// Uses Node's built-in fetch (Node 18+), so no new dependency is required.

const DISCORD_API = 'https://discord.com/api/v10';

function getRedirectUri() {
  if (process.env.DASHBOARD_REDIRECT_URI) return process.env.DASHBOARD_REDIRECT_URI;
  const base = process.env.DASHBOARD_BASE_URL;
  if (!base) {
    throw new Error(
      'Set DASHBOARD_BASE_URL (e.g. https://your-app.up.railway.app) or DASHBOARD_REDIRECT_URI in your environment variables.'
    );
  }
  return `${base.replace(/\/$/, '')}/auth/callback`;
}

export function getAuthorizeUrl(state) {
  const clientId = process.env.CLIENT_ID;
  const redirectUri = getRedirectUri();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
    prompt: 'consent',
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken(code) {
  const redirectUri = getRedirectUri();
  const body = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord token exchange failed (${res.status}): ${text}`);
  }

  return res.json(); // { access_token, token_type, expires_in, refresh_token, scope }
}

export async function refreshAccessToken(refreshToken) {
  const body = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
  });

  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Discord token refresh failed (${res.status}): ${text}`);
  }

  return res.json(); // { access_token, refresh_token, expires_in, ... }
}

export async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch Discord user (${res.status})`);
  return res.json(); // { id, username, avatar, discriminator, ... }
}

export async function fetchUserGuilds(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me/guilds`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Failed to fetch user guilds (${res.status})`);
  return res.json(); // [{ id, name, icon, owner, permissions, ... }]
}

// Discord permission bit for "Manage Server" / Administrator.
const MANAGE_GUILD = 1n << 5n;
const ADMINISTRATOR = 1n << 3n;

export function canManageGuild(permissions) {
  try {
    const bits = BigInt(permissions);
    return (bits & MANAGE_GUILD) === MANAGE_GUILD || (bits & ADMINISTRATOR) === ADMINISTRATOR;
  } catch {
    return false;
  }
}

export function avatarUrl(user) {
  if (!user?.avatar) {
    // Default Discord avatar fallback.
    return `https://cdn.discordapp.com/embed/avatars/0.png`;
  }
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}`;
}

export function guildIconUrl(guild) {
  if (!guild?.icon) return null;
  const ext = guild.icon.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${ext}`;
}
