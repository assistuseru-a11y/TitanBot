// apiRoutes.js
// REST API consumed by the dashboard frontend. All routes require a logged-in
// session (see session.js) and verify the user actually has Manage Server
// permission on the guild they're trying to touch.

import express from 'express';
import { requireAuth } from './session.js';
import { fetchUserGuilds, canManageGuild, guildIconUrl } from './discordOAuth.js';
import { getGuildConfig, updateGuildConfig } from '../services/guildConfig.js';
import { getGuildTicketStats } from '../utils/database/tickets.js';
import { getLevelingConfig, saveLevelingConfig, getLeaderboard } from '../services/leveling.js';
import {
  buildCommandRegistry,
  getCommandAccessSnapshot,
  disableCommand,
  enableCommand,
  disableCategory,
  enableCategory,
} from '../services/commandAccessService.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Public — no auth required. Exposes only non-secret values the frontend
// needs to build invite links etc.
router.get('/public-config', (req, res) => {
  res.json({ clientId: process.env.CLIENT_ID || null });
});

router.use(requireAuth);

// Attach the bot client (set up in index.js when mounting the router).
function getClient(req) {
  return req.app.get('botClient');
}

// ---------------------------------------------------------------------------
// Helper: confirm the logged-in user can manage this guild, and the bot is
// actually in it. Returns the discord.js Guild object on success.
// ---------------------------------------------------------------------------
async function authorizeGuildAccess(req, res, guildId) {
  const client = getClient(req);
  const guild = client?.guilds?.cache?.get(guildId);

  if (!guild) {
    res.status(404).json({ error: 'Bot is not in that server.' });
    return null;
  }

  try {
    const userGuilds = await fetchUserGuilds(req.session.accessToken);
    const match = userGuilds.find((g) => g.id === guildId);
    if (!match || !canManageGuild(match.permissions)) {
      res.status(403).json({ error: 'You do not have permission to manage this server.' });
      return null;
    }
  } catch (error) {
    logger.error('Dashboard authorizeGuildAccess error:', error);
    res.status(502).json({ error: 'Failed to verify Discord permissions. Try logging in again.' });
    return null;
  }

  return guild;
}

// ---------------------------------------------------------------------------
// GET /api/me
// ---------------------------------------------------------------------------
router.get('/me', (req, res) => {
  res.json({ user: req.session.user });
});

// ---------------------------------------------------------------------------
// GET /api/guilds — servers the user can manage AND the bot is in
// ---------------------------------------------------------------------------
router.get('/guilds', async (req, res) => {
  try {
    const client = getClient(req);
    const userGuilds = await fetchUserGuilds(req.session.accessToken);

    const manageable = userGuilds.filter((g) => canManageGuild(g.permissions));

    const result = manageable.map((g) => {
      const botGuild = client?.guilds?.cache?.get(g.id);
      return {
        id: g.id,
        name: g.name,
        icon: guildIconUrl(g),
        botInGuild: !!botGuild,
        memberCount: botGuild?.memberCount ?? null,
      };
    });

    // Bot-present servers first, then alphabetical.
    result.sort((a, b) => {
      if (a.botInGuild !== b.botInGuild) return a.botInGuild ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    res.json({ guilds: result });
  } catch (error) {
    logger.error('Dashboard GET /guilds error:', error);
    res.status(502).json({ error: 'Failed to load your Discord servers. Try logging in again.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/guilds/:id/overview — quick stats for the server's home page
// ---------------------------------------------------------------------------
router.get('/guilds/:id/overview', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  try {
    const [config, ticketStats] = await Promise.all([
      getGuildConfig(getClient(req), guild.id),
      getGuildTicketStats(guild.id),
    ]);

    res.json({
      guild: {
        id: guild.id,
        name: guild.name,
        icon: guild.iconURL?.({ size: 128 }) ?? null,
        memberCount: guild.memberCount,
        channelCount: guild.channels?.cache?.size ?? 0,
        roleCount: guild.roles?.cache?.size ?? 0,
        createdAt: guild.createdAt,
      },
      config,
      tickets: ticketStats,
    });
  } catch (error) {
    logger.error(`Dashboard GET /guilds/${guild.id}/overview error:`, error);
    res.status(500).json({ error: 'Failed to load server overview.' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/guilds/:id/config — full raw config (for settings forms)
// ---------------------------------------------------------------------------
router.get('/guilds/:id/config', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  try {
    const config = await getGuildConfig(getClient(req), guild.id);
    res.json({ config });
  } catch (error) {
    logger.error(`Dashboard GET /guilds/${guild.id}/config error:`, error);
    res.status(500).json({ error: 'Failed to load server configuration.' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/guilds/:id/config — partial update, validated by schemas.js
// (via updateGuildConfig, same code path the bot's own commands use)
// ---------------------------------------------------------------------------
router.patch('/guilds/:id/config', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  try {
    const updated = await updateGuildConfig(getClient(req), guild.id, req.body || {});
    res.json({ config: updated });
  } catch (error) {
    logger.warn(`Dashboard PATCH /guilds/${guild.id}/config rejected:`, error.message);
    res.status(400).json({ error: error.userMessage || 'Invalid configuration. Changes were not saved.' });
  }
});

// ---------------------------------------------------------------------------
// Channels / roles list, for populating <select> dropdowns in the frontend
// ---------------------------------------------------------------------------
router.get('/guilds/:id/channels', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  const channels = guild.channels.cache
    .filter((c) => c.isTextBased?.() && !c.isThread?.())
    .map((c) => ({ id: c.id, name: c.name, type: c.type }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ channels });
});

router.get('/guilds/:id/roles', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  const roles = guild.roles.cache
    .filter((r) => r.id !== guild.id) // exclude @everyone
    .map((r) => ({ id: r.id, name: r.name, color: r.hexColor }))
    .sort((a, b) => a.name.localeCompare(b.name));

  res.json({ roles });
});

// ---------------------------------------------------------------------------
// Leveling settings
// ---------------------------------------------------------------------------
router.get('/guilds/:id/leveling', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  try {
    const [levelingConfig, leaderboard] = await Promise.all([
      getLevelingConfig(getClient(req), guild.id),
      getLeaderboard(getClient(req), guild.id, 10),
    ]);
    res.json({ leveling: levelingConfig, leaderboard });
  } catch (error) {
    logger.error(`Dashboard GET /guilds/${guild.id}/leveling error:`, error);
    res.status(500).json({ error: 'Failed to load leveling settings.' });
  }
});

router.patch('/guilds/:id/leveling', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  try {
    const current = await getLevelingConfig(getClient(req), guild.id);
    const merged = { ...current, ...req.body };
    await saveLevelingConfig(getClient(req), guild.id, merged);
    res.json({ leveling: merged });
  } catch (error) {
    logger.warn(`Dashboard PATCH /guilds/${guild.id}/leveling rejected:`, error.message);
    res.status(400).json({ error: 'Failed to save leveling settings.' });
  }
});

// ---------------------------------------------------------------------------
// Command / category toggles
// ---------------------------------------------------------------------------
router.get('/guilds/:id/commands', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  try {
    const client = getClient(req);
    buildCommandRegistry(client); // ensure registry is populated
    const config = await getGuildConfig(client, guild.id);
    const snapshot = getCommandAccessSnapshot(client, config);
    res.json(snapshot);
  } catch (error) {
    logger.error(`Dashboard GET /guilds/${guild.id}/commands error:`, error);
    res.status(500).json({ error: 'Failed to load command list.' });
  }
});

router.post('/guilds/:id/commands/:name/toggle', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  const { enabled } = req.body || {};
  try {
    const client = getClient(req);
    if (enabled) {
      await enableCommand(client, guild.id, req.params.name);
    } else {
      await disableCommand(client, guild.id, req.params.name);
    }
    res.json({ ok: true });
  } catch (error) {
    logger.warn(`Dashboard command toggle rejected:`, error.message);
    res.status(400).json({ error: error.userMessage || error.message || 'Failed to update command.' });
  }
});

router.post('/guilds/:id/categories/:key/toggle', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  const { enabled } = req.body || {};
  try {
    const client = getClient(req);
    if (enabled) {
      await enableCategory(client, guild.id, req.params.key);
    } else {
      await disableCategory(client, guild.id, req.params.key);
    }
    res.json({ ok: true });
  } catch (error) {
    logger.warn(`Dashboard category toggle rejected:`, error.message);
    res.status(400).json({ error: error.userMessage || error.message || 'Failed to update category.' });
  }
});

// ---------------------------------------------------------------------------
// Ticket stats (standalone, for the Tickets settings page)
// ---------------------------------------------------------------------------
router.get('/guilds/:id/tickets', async (req, res) => {
  const guild = await authorizeGuildAccess(req, res, req.params.id);
  if (!guild) return;

  try {
    const stats = await getGuildTicketStats(guild.id);
    res.json({ tickets: stats });
  } catch (error) {
    logger.error(`Dashboard GET /guilds/${guild.id}/tickets error:`, error);
    res.status(500).json({ error: 'Failed to load ticket stats.' });
  }
});

export default router;
