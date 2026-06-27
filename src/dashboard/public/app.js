// app.js — TitanBot Dashboard frontend (vanilla JS, no build step)

const app = document.getElementById('app');
const state = {
  user: null,
  guilds: [],
  currentGuildId: null,
  currentTab: 'overview',
  cache: {}, // per-guild cached API responses, keyed by `${guildId}:${endpoint}`
};

// ---------------------------------------------------------------------------
// API helper
// ---------------------------------------------------------------------------
async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    ...options,
  });
  if (res.status === 401) {
    renderLogin();
    throw new Error('Not authenticated');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function qs(params) {
  const u = new URLSearchParams(window.location.search);
  return params ? u.get(params) : u;
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
async function boot() {
  const errorParam = qs('error');
  try {
    const { clientId } = await api('/public-config');
    state.clientId = clientId;
  } catch { /* non-fatal, invite button will just be disabled */ }
  try {
    const { user } = await api('/me');
    state.user = user;
    const { guilds } = await api('/guilds');
    state.guilds = guilds;
    renderShell();
  } catch {
    renderLogin(errorParam);
  }
}

const ERROR_MESSAGES = {
  access_denied: 'You cancelled the Discord login.',
  invalid_state: 'Login expired before it finished — try again.',
  oauth_failed: 'Discord login failed. Try again in a moment.',
};

function renderLogin(errorCode) {
  app.innerHTML = `
    <div class="center-screen">
      <div class="login-card">
        <div class="login-mark">T</div>
        <h1>TitanBot Dashboard</h1>
        <p>Manage your server's settings, moderation, leveling, and tickets — all in one place.</p>
        ${errorCode && ERROR_MESSAGES[errorCode] ? `<div class="error-banner">${ERROR_MESSAGES[errorCode]}</div>` : ''}
        <button class="btn-discord" id="login-btn">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.79 19.79 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/></svg>
          Login with Discord
        </button>
      </div>
    </div>`;
  document.getElementById('login-btn').onclick = () => { window.location.href = '/auth/login'; };
}

// ---------------------------------------------------------------------------
// Shell (sidebar + content)
// ---------------------------------------------------------------------------
function renderShell() {
  if (!state.currentGuildId) {
    renderServerPicker();
    return;
  }
  renderDashboard();
}

function renderServerPicker() {
  const cards = state.guilds.map((g) => `
    <div class="picker-card ${g.botInGuild ? '' : 'disabled'}" data-id="${g.id}" data-bot="${g.botInGuild}">
      ${g.icon ? `<img src="${g.icon}" alt="">` : `<div class="fallback-icon">${escapeHtml(g.name.slice(0, 2).toUpperCase())}</div>`}
      <div class="name">${escapeHtml(g.name)}</div>
      ${g.botInGuild
        ? `<span class="pill active">● Active</span>`
        : `<span class="pill invite">+ Add TitanBot</span>`}
    </div>
  `).join('');

  app.innerHTML = `
    <div class="layout" style="width:100%;">
      <main class="content" style="max-width:1080px; margin:0 auto; width:100%;">
        <div class="page-head">
          <div class="eyebrow">Dashboard</div>
          <h1>Choose a server</h1>
          <p>Pick a server to manage. Servers without TitanBot need an invite first.</p>
        </div>
        <div class="picker-grid">${cards || ''}</div>
        ${state.guilds.length === 0 ? `<div class="empty-state"><div class="ic">🛰️</div>No manageable servers found. You need Manage Server permission.</div>` : ''}
      </main>
    </div>`;

  document.querySelectorAll('.picker-card').forEach((card) => {
    card.addEventListener('click', () => {
      if (card.dataset.bot !== 'true') {
        if (!state.clientId) {
          alert('Invite link is not configured yet. Ask the bot owner to set CLIENT_ID.');
          return;
        }
        const permissions = '395677800534'; // sensible default: moderation + channel + role management, no admin
        window.open(`https://discord.com/oauth2/authorize?client_id=${state.clientId}&scope=bot%20applications.commands&permissions=${permissions}&guild_id=${card.dataset.id}`, '_blank');
        return;
      }
      state.currentGuildId = card.dataset.id;
      state.currentTab = 'overview';
      renderDashboard();
    });
  });
}

const NAV_ITEMS = [
  { key: 'overview', icon: '🏠', label: 'Overview' },
  { key: 'general', icon: '⚙️', label: 'General' },
  { key: 'welcome', icon: '👋', label: 'Welcome' },
  { key: 'moderation', icon: '🛡️', label: 'Moderation' },
  { key: 'logging', icon: '📝', label: 'Logging' },
  { key: 'verification', icon: '✅', label: 'Verification' },
  { key: 'tickets', icon: '🎫', label: 'Tickets' },
  { key: 'leveling', icon: '📊', label: 'Leveling' },
  { key: 'commands', icon: '🧩', label: 'Commands' },
];

function renderDashboard() {
  const guild = state.guilds.find((g) => g.id === state.currentGuildId);

  app.innerHTML = `
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <div class="mark">T</div>
          <div class="name">TitanBot</div>
        </div>
        <div class="server-switcher" id="switch-server">
          ${guild?.icon ? `<img src="${guild.icon}" alt="">` : `<div class="fallback-icon" style="width:28px;height:28px;border-radius:7px;background:var(--surface-raised);display:flex;align-items:center;justify-content:center;font-size:11px;">${escapeHtml((guild?.name || '?').slice(0, 2).toUpperCase())}</div>`}
          <div class="meta">
            <div class="n">${escapeHtml(guild?.name || 'Server')}</div>
            <div class="s">Switch server</div>
          </div>
          <div class="chev">⇄</div>
        </div>
        <div class="nav-section-label">Manage</div>
        <nav class="nav-list" id="nav-list">
          ${NAV_ITEMS.map((item) => `
            <button class="nav-item ${item.key === state.currentTab ? 'active' : ''}" data-key="${item.key}">
              <span class="ic">${item.icon}</span>${item.label}
            </button>`).join('')}
        </nav>
        <div class="sidebar-foot">
          <img src="${avatarUrl(state.user)}" alt="">
          <div class="meta"><div class="n">${escapeHtml(state.user.username)}</div></div>
          <button id="logout-btn" title="Log out">⏻</button>
        </div>
      </aside>
      <main class="content" id="main-content"></main>
    </div>`;

  document.getElementById('switch-server').onclick = () => {
    state.currentGuildId = null;
    renderShell();
  };
  document.getElementById('logout-btn').onclick = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    window.location.reload();
  };
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.onclick = () => {
      state.currentTab = btn.dataset.key;
      renderDashboard();
    };
  });

  renderTab(state.currentTab);
}

function avatarUrl(user) {
  if (!user?.avatar) return 'https://cdn.discordapp.com/embed/avatars/0.png';
  const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
  return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}`;
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ---------------------------------------------------------------------------
// Tab content
// ---------------------------------------------------------------------------
function mainEl() { return document.getElementById('main-content'); }

function setLoading() {
  mainEl().innerHTML = `<div class="card"><div class="skeleton" style="height:24px;width:200px;margin-bottom:16px;"></div><div class="skeleton" style="height:120px;"></div></div>`;
}

async function renderTab(tab) {
  setLoading();
  const gid = state.currentGuildId;
  try {
    if (tab === 'overview') return renderOverview(gid);
    if (tab === 'general') return renderGeneral(gid);
    if (tab === 'welcome') return renderWelcome(gid);
    if (tab === 'moderation') return renderModeration(gid);
    if (tab === 'logging') return renderLogging(gid);
    if (tab === 'verification') return renderVerification(gid);
    if (tab === 'tickets') return renderTickets(gid);
    if (tab === 'leveling') return renderLeveling(gid);
    if (tab === 'commands') return renderCommands(gid);
  } catch (err) {
    mainEl().innerHTML = `<div class="card empty-state"><div class="ic">⚠️</div>${escapeHtml(err.message)}</div>`;
  }
}

function pageHead(eyebrow, title, desc) {
  return `<div class="page-head"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1><p>${desc}</p></div>`;
}

function saveBar(id) {
  return `<div class="save-bar"><span class="save-status" id="${id}-status"></span><button class="btn" id="${id}-save">Save changes</button></div>`;
}

async function flashSave(id, fn) {
  const statusEl = document.getElementById(`${id}-status`);
  const btn = document.getElementById(`${id}-save`);
  btn.disabled = true;
  statusEl.className = 'save-status';
  statusEl.textContent = 'Saving…';
  try {
    await fn();
    statusEl.className = 'save-status ok';
    statusEl.textContent = 'Saved';
    setTimeout(() => { statusEl.textContent = ''; }, 2500);
  } catch (err) {
    statusEl.className = 'save-status err';
    statusEl.textContent = err.message || 'Failed to save';
  } finally {
    btn.disabled = false;
  }
}

function toggleHtml(idAttr, checked, title, desc) {
  return `
    <div class="toggle-row">
      <div class="lbl-group"><div class="t">${title}</div>${desc ? `<div class="d">${desc}</div>` : ''}</div>
      <label class="switch">
        <input type="checkbox" id="${idAttr}" ${checked ? 'checked' : ''}>
        <span class="track"></span><span class="knob"></span>
      </label>
    </div>`;
}

async function channelOptions(gid, selectedId) {
  const { channels } = await api(`/guilds/${gid}/channels`);
  return `<option value="">None</option>` + channels.map((c) =>
    `<option value="${c.id}" ${c.id === selectedId ? 'selected' : ''}>#${escapeHtml(c.name)}</option>`
  ).join('');
}

async function roleOptions(gid, selectedId) {
  const { roles } = await api(`/guilds/${gid}/roles`);
  return `<option value="">None</option>` + roles.map((r) =>
    `<option value="${r.id}" ${r.id === selectedId ? 'selected' : ''}>${escapeHtml(r.name)}</option>`
  ).join('');
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------
async function renderOverview(gid) {
  const { guild, tickets } = await api(`/guilds/${gid}/overview`);
  mainEl().innerHTML = `
    ${pageHead('Overview', escapeHtml(guild.name), 'A quick snapshot of this server\u2019s activity.')}
    <div class="stat-grid">
      <div class="stat-box"><div class="val">${guild.memberCount}</div><div class="lbl">Members</div></div>
      <div class="stat-box"><div class="val">${guild.channelCount}</div><div class="lbl">Channels</div></div>
      <div class="stat-box"><div class="val">${guild.roleCount}</div><div class="lbl">Roles</div></div>
      <div class="stat-box accent"><div class="val">${tickets.openCount}</div><div class="lbl">Open tickets</div></div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Ticket activity</h2></div>
      <div class="stat-grid">
        <div class="stat-box"><div class="val">${tickets.openCount}</div><div class="lbl">Open</div></div>
        <div class="stat-box"><div class="val">${tickets.closedCount}</div><div class="lbl">Closed</div></div>
        <div class="stat-box"><div class="val">${tickets.avgRating ?? '—'}</div><div class="lbl">Avg rating</div></div>
        <div class="stat-box"><div class="val">${tickets.avgCloseTimeMs ? Math.round(tickets.avgCloseTimeMs / 60000) + 'm' : '—'}</div><div class="lbl">Avg close time</div></div>
      </div>
    </div>`;
}

// ---------------------------------------------------------------------------
// General
// ---------------------------------------------------------------------------
async function renderGeneral(gid) {
  const { config } = await api(`/guilds/${gid}/config`);
  const modOpts = await roleOptions(gid, config.modRole);
  const adminOpts = await roleOptions(gid, config.adminRole);
  const autoOpts = await roleOptions(gid, config.autoRole);

  mainEl().innerHTML = `
    ${pageHead('Settings', 'General', 'Core behavior: command prefix and staff roles.')}
    <div class="card">
      <div class="card-head"><h2>Command prefix</h2><span class="hint">Used for text-based commands</span></div>
      <div class="field">
        <label for="g-prefix">Prefix</label>
        <input type="text" id="g-prefix" maxlength="5" value="${escapeHtml(config.prefix || '!')}">
      </div>
    </div>
    <div class="card">
      <div class="card-head"><h2>Staff roles</h2></div>
      <div class="field-row">
        <div class="field"><label for="g-modrole">Moderator role</label><select id="g-modrole">${modOpts}</select></div>
        <div class="field"><label for="g-adminrole">Admin role</label><select id="g-adminrole">${adminOpts}</select></div>
      </div>
      <div class="field"><label for="g-autorole">Auto-role on join</label><select id="g-autorole">${autoOpts}</select></div>
    </div>
    ${saveBar('general')}`;

  document.getElementById('general-save').onclick = () => flashSave('general', async () => {
    await api(`/guilds/${gid}/config`, {
      method: 'PATCH',
      body: JSON.stringify({
        prefix: document.getElementById('g-prefix').value || '!',
        modRole: document.getElementById('g-modrole').value || null,
        adminRole: document.getElementById('g-adminrole').value || null,
        autoRole: document.getElementById('g-autorole').value || null,
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------
async function renderWelcome(gid) {
  const { config } = await api(`/guilds/${gid}/config`);
  const channelOpts = await channelOptions(gid, config.welcomeChannel);

  mainEl().innerHTML = `
    ${pageHead('Settings', 'Welcome', 'Greet new members when they join.')}
    <div class="card">
      <div class="field">
        <label for="w-channel">Welcome channel</label>
        <select id="w-channel">${channelOpts}</select>
      </div>
      <div class="field">
        <label for="w-message">Welcome message</label>
        <div class="desc">Use {user} and {server} as placeholders.</div>
        <textarea id="w-message">${escapeHtml(config.welcomeMessage || 'Welcome {user} to {server}!')}</textarea>
      </div>
    </div>
    ${saveBar('welcome')}`;

  document.getElementById('welcome-save').onclick = () => flashSave('welcome', async () => {
    await api(`/guilds/${gid}/config`, {
      method: 'PATCH',
      body: JSON.stringify({
        welcomeChannel: document.getElementById('w-channel').value || null,
        welcomeMessage: document.getElementById('w-message').value,
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------
async function renderModeration(gid) {
  const { config } = await api(`/guilds/${gid}/config`);
  const reportOpts = await channelOptions(gid, config.reportChannelId);

  mainEl().innerHTML = `
    ${pageHead('Settings', 'Moderation', 'Where moderation reports get sent.')}
    <div class="card">
      <div class="field">
        <label for="m-report">Report channel</label>
        <div class="desc">Member reports and flagged content go here.</div>
        <select id="m-report">${reportOpts}</select>
      </div>
    </div>
    ${saveBar('moderation')}`;

  document.getElementById('moderation-save').onclick = () => flashSave('moderation', async () => {
    await api(`/guilds/${gid}/config`, {
      method: 'PATCH',
      body: JSON.stringify({ reportChannelId: document.getElementById('m-report').value || null }),
    });
  });
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------
async function renderLogging(gid) {
  const { config } = await api(`/guilds/${gid}/config`);
  const logging = config.logging || { enabled: false, channels: {} };
  const auditOpts = await channelOptions(gid, logging.channels?.audit);
  const reportsOpts = await channelOptions(gid, logging.channels?.reports);

  mainEl().innerHTML = `
    ${pageHead('Settings', 'Logging', 'Track server events like joins, leaves, and edits.')}
    <div class="card">
      ${toggleHtml('l-enabled', logging.enabled, 'Enable logging', 'Turn server event logging on or off.')}
    </div>
    <div class="card">
      <div class="card-head"><h2>Log channels</h2></div>
      <div class="field-row">
        <div class="field"><label for="l-audit">Audit log channel</label><select id="l-audit">${auditOpts}</select></div>
        <div class="field"><label for="l-reports">Reports channel</label><select id="l-reports">${reportsOpts}</select></div>
      </div>
    </div>
    ${saveBar('logging')}`;

  document.getElementById('logging-save').onclick = () => flashSave('logging', async () => {
    await api(`/guilds/${gid}/config`, {
      method: 'PATCH',
      body: JSON.stringify({
        logging: {
          ...logging,
          enabled: document.getElementById('l-enabled').checked,
          channels: {
            ...(logging.channels || {}),
            audit: document.getElementById('l-audit').value || null,
            reports: document.getElementById('l-reports').value || null,
          },
        },
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------
async function renderVerification(gid) {
  const { config } = await api(`/guilds/${gid}/config`);
  const v = config.verification || { enabled: false, buttonText: 'Verify' };
  const channelOpts = await channelOptions(gid, v.channelId);
  const roleOpts = await roleOptions(gid, v.roleId);

  mainEl().innerHTML = `
    ${pageHead('Settings', 'Verification', 'Require new members to verify before accessing the server.')}
    <div class="card">
      ${toggleHtml('v-enabled', v.enabled, 'Enable verification', 'New members must verify to get access.')}
    </div>
    <div class="card">
      <div class="field-row">
        <div class="field"><label for="v-channel">Verification channel</label><select id="v-channel">${channelOpts}</select></div>
        <div class="field"><label for="v-role">Verified role</label><select id="v-role">${roleOpts}</select></div>
      </div>
      <div class="field">
        <label for="v-button">Button text</label>
        <input type="text" id="v-button" value="${escapeHtml(v.buttonText || 'Verify')}">
      </div>
      <div class="field">
        <label for="v-message">Verification message</label>
        <textarea id="v-message">${escapeHtml(v.message || '')}</textarea>
      </div>
    </div>
    ${saveBar('verification')}`;

  document.getElementById('verification-save').onclick = () => flashSave('verification', async () => {
    await api(`/guilds/${gid}/config`, {
      method: 'PATCH',
      body: JSON.stringify({
        verification: {
          ...v,
          enabled: document.getElementById('v-enabled').checked,
          channelId: document.getElementById('v-channel').value || null,
          roleId: document.getElementById('v-role').value || null,
          buttonText: document.getElementById('v-button').value || 'Verify',
          message: document.getElementById('v-message').value,
        },
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Tickets
// ---------------------------------------------------------------------------
async function renderTickets(gid) {
  const { tickets } = await api(`/guilds/${gid}/tickets`);
  mainEl().innerHTML = `
    ${pageHead('Settings', 'Tickets', 'Support ticket activity for this server.')}
    <div class="stat-grid">
      <div class="stat-box accent"><div class="val">${tickets.openCount}</div><div class="lbl">Open now</div></div>
      <div class="stat-box"><div class="val">${tickets.closedCount}</div><div class="lbl">Closed total</div></div>
      <div class="stat-box"><div class="val">${tickets.avgRating ?? '—'}</div><div class="lbl">Avg satisfaction</div></div>
      <div class="stat-box"><div class="val">${tickets.avgCloseTimeMs ? Math.round(tickets.avgCloseTimeMs / 60000) + 'm' : '—'}</div><div class="lbl">Avg close time</div></div>
    </div>
    <div class="card">
      <p style="color:var(--text-dim); margin:0;">Ticket category setup, panels, and transcripts are configured with the <code style="font-family:var(--font-mono); background:var(--surface-raised); padding:2px 6px; border-radius:4px;">/ticket</code> commands in Discord. This page shows live stats only.</p>
    </div>`;
}

// ---------------------------------------------------------------------------
// Leveling
// ---------------------------------------------------------------------------
async function renderLeveling(gid) {
  const { leveling, leaderboard } = await api(`/guilds/${gid}/leveling`);
  const channelOpts = await channelOptions(gid, leveling.levelUpChannel);

  mainEl().innerHTML = `
    ${pageHead('Settings', 'Leveling', 'XP, level-ups, and the leaderboard.')}
    <div class="card">
      ${toggleHtml('lv-enabled', leveling.enabled, 'Enable leveling', 'Members earn XP from chatting.')}
      ${toggleHtml('lv-announce', leveling.announceLevelUp, 'Announce level-ups', 'Post a message when someone levels up.')}
    </div>
    <div class="card">
      <div class="field-row">
        <div class="field"><label for="lv-min">Min XP per message</label><input type="number" id="lv-min" value="${leveling.xpPerMessage?.min ?? 15}"></div>
        <div class="field"><label for="lv-max">Max XP per message</label><input type="number" id="lv-max" value="${leveling.xpPerMessage?.max ?? 25}"></div>
      </div>
      <div class="field-row">
        <div class="field"><label for="lv-cooldown">XP cooldown (seconds)</label><input type="number" id="lv-cooldown" value="${leveling.xpCooldown ?? 20}"></div>
        <div class="field"><label for="lv-mult">XP multiplier</label><input type="number" step="0.1" id="lv-mult" value="${leveling.xpMultiplier ?? 1}"></div>
      </div>
      <div class="field"><label for="lv-channel">Level-up announcement channel</label><div class="desc">Leave empty to announce in the channel where the member leveled up.</div><select id="lv-channel">${channelOpts}</select></div>
      <div class="field">
        <label for="lv-message">Level-up message</label>
        <div class="desc">Use {user} and {level} as placeholders.</div>
        <textarea id="lv-message">${escapeHtml(leveling.levelUpMessage || '{user} has leveled up to level {level}!')}</textarea>
      </div>
    </div>
    ${saveBar('leveling')}
    <div class="card">
      <div class="card-head"><h2>Leaderboard</h2><span class="hint">Top 10 by XP</span></div>
      ${leaderboard.length === 0
        ? `<div class="empty-state"><div class="ic">📊</div>No leveling activity yet.</div>`
        : leaderboard.map((row, i) => `
          <div class="leaderboard-row">
            <div class="rank">#${i + 1}</div>
            <div class="uid">${escapeHtml(row.username || row.userId || '—')}</div>
            <div class="lvl">Lv. ${row.level ?? '—'}</div>
          </div>`).join('')}
    </div>`;

  document.getElementById('leveling-save').onclick = () => flashSave('leveling', async () => {
    await api(`/guilds/${gid}/leveling`, {
      method: 'PATCH',
      body: JSON.stringify({
        enabled: document.getElementById('lv-enabled').checked,
        announceLevelUp: document.getElementById('lv-announce').checked,
        xpPerMessage: {
          min: Number(document.getElementById('lv-min').value) || 15,
          max: Number(document.getElementById('lv-max').value) || 25,
        },
        xpCooldown: Number(document.getElementById('lv-cooldown').value) || 20,
        xpMultiplier: Number(document.getElementById('lv-mult').value) || 1,
        levelUpChannel: document.getElementById('lv-channel').value || null,
        levelUpMessage: document.getElementById('lv-message').value,
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------
async function renderCommands(gid) {
  const snapshot = await api(`/guilds/${gid}/commands`);

  mainEl().innerHTML = `
    ${pageHead('Settings', 'Commands', `${snapshot.enabledTotal} of ${snapshot.totalCommands} commands enabled.`)}
    ${snapshot.categories.map((cat) => `
      <div class="cat-block">
        <div class="cat-head" data-cat="${cat.key}">
          <div class="left"><span class="icon">${cat.icon}</span><span class="title">${escapeHtml(cat.displayName)}</span></div>
          <div style="display:flex; align-items:center; gap:14px;">
            <span class="count">${cat.enabledCount}/${cat.totalCount}</span>
            <label class="switch" onclick="event.stopPropagation()">
              <input type="checkbox" class="cat-toggle" data-cat="${cat.key}" ${!cat.categoryDisabled ? 'checked' : ''}>
              <span class="track"></span><span class="knob"></span>
            </label>
          </div>
        </div>
        <div class="cat-body" id="body-${cat.key}">
          ${cat.commands.map((cmd) => `
            <div class="cmd-row">
              <span class="name ${cat.disabledCommandNames.includes(cmd.name) ? 'disabled' : ''}">${escapeHtml(cmd.name)}${cmd.protected ? '<span class="protected-tag">protected</span>' : ''}</span>
              ${cmd.protected
                ? `<span class="hint" style="color:var(--text-faint); font-size:11px;">always on</span>`
                : `<label class="switch">
                    <input type="checkbox" class="cmd-toggle" data-cmd="${cmd.name}" ${!cat.disabledCommandNames.includes(cmd.name) ? 'checked' : ''}>
                    <span class="track"></span><span class="knob"></span>
                  </label>`}
            </div>`).join('')}
        </div>
      </div>`).join('')}`;

  document.querySelectorAll('.cat-head').forEach((head) => {
    head.addEventListener('click', (e) => {
      if (e.target.closest('.switch')) return;
      const body = document.getElementById(`body-${head.dataset.cat}`);
      body.classList.toggle('open');
    });
  });

  document.querySelectorAll('.cat-toggle').forEach((toggle) => {
    toggle.addEventListener('change', async () => {
      try {
        await api(`/guilds/${gid}/categories/${toggle.dataset.cat}/toggle`, {
          method: 'POST',
          body: JSON.stringify({ enabled: toggle.checked }),
        });
        renderCommands(gid);
      } catch (err) {
        alert(err.message);
        toggle.checked = !toggle.checked;
      }
    });
  });

  document.querySelectorAll('.cmd-toggle').forEach((toggle) => {
    toggle.addEventListener('change', async () => {
      try {
        await api(`/guilds/${gid}/commands/${encodeURIComponent(toggle.dataset.cmd)}/toggle`, {
          method: 'POST',
          body: JSON.stringify({ enabled: toggle.checked }),
        });
      } catch (err) {
        alert(err.message);
        toggle.checked = !toggle.checked;
      }
    });
  });
}

boot();
