// ============================================================================
// MERGED DISCORD BOT — with multi-select setup menus
// discord.js v14
// ============================================================================

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  UserSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  PermissionFlagsBits,
  AuditLogEvent,
  MessageFlags,
  AttachmentBuilder,
  OverwriteType
} = require('discord.js');

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
require('dotenv').config();

// ============================================================================
// PATHS & CONSTANTS
// ============================================================================

const CONFIG_PATH = path.join(__dirname, 'config.json');
const CONFIG_TMP = path.join(__dirname, 'config.json.tmp');
const CONFIG_BAK = path.join(__dirname, 'config.json.bak');

const TIER_INHERITANCE = {
  staff: ['staff'],
  admin: ['staff', 'admin'],
  highrank: ['staff', 'admin', 'highrank'],
  management: ['staff', 'admin', 'highrank', 'management']
};

const DEFAULT_COMMAND_PERMS = {
  help: ['everyone'], ping: ['everyone'], avatar: ['everyone'],
  whois: ['everyone'], userinfo: ['everyone'], serverinfo: ['everyone'],
  suggest: ['everyone'], feedback: ['everyone'], ticket: ['everyone'],
  mute: ['staff'], unmute: ['staff'], warn: ['staff'], clear: ['staff'],
  purge: ['staff'], history: ['staff'], loguser: ['staff'],
  robloxhistory: ['staff'], nickname: ['staff'], close: ['staff'],
  claim: ['staff'], unclaim: ['staff'], tadd: ['staff'], tremove: ['staff'],
  infract: ['staff'], poll: ['staff'],
  kick: ['admin'], ban: ['admin'], unban: ['admin'],
  addrole: ['admin'], removerole: ['admin'],
  giveaway: ['admin'], 'giveaway-end': ['admin'], 'giveaway-reroll': ['admin'],
  'suggestion-approve': ['admin'], 'suggestion-deny': ['admin'],
  accept: ['highrank'], deny: ['highrank'], promote: ['highrank'], demote: ['highrank'],
  acceptsetup: ['management'], setup: ['management'],
  antinuke: ['management'], customcmd: ['management']
};

const RESERVED_COMMAND_NAMES = new Set([
  ...Object.keys(DEFAULT_COMMAND_PERMS),
  'mc', 'whois', 'avatar', 'clear', 'purge', 'tadd', 'tremove',
  'help', 'ping', 'userinfo', 'serverinfo', 'mute', 'unmute', 'warn',
  'kick', 'ban', 'unban', 'history', 'loguser', 'robloxhistory',
  'addrole', 'removerole', 'nickname', 'ticket', 'close', 'claim',
  'unclaim', 'accept', 'deny', 'promote', 'demote', 'infract',
  'acceptsetup', 'setup', 'poll', 'giveaway', 'suggest', 'feedback',
  'antinuke', 'customcmd'
]);

// ============================================================================
// CLIENT
// ============================================================================

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Message, Partials.Channel, Partials.GuildMember, Partials.User]
});

// ============================================================================
// STATE
// ============================================================================

let config = { guilds: {} };
let saveTimer = null;

const tierCache = new Map();
const guildConfigCache = new Map();
const ghostPingTracker = new Map();
const pollStore = new Map();
const giveawayStore = new Map();
const endedGiveawayStore = new Map();
const pendingCloseConfirmations = new Map();
const slurRegexCache = new Map();
const slashCache = new Map();
const automodDeletedIds = new Set();
const pendingSetupChannel = new Map();
const pendingSetupRoles = new Map();
const pendingSetupTicketType = new Map();

// ============================================================================
// DEFAULT CONFIG
// ============================================================================

function defaultGuildConfig() {
  return {
    prefix: '!',
    roles: { staff: [], admin: [], highrank: [], management: [], exempt: [], accept: [], hrPing: null },
    channels: {
      log: null, staffLog: null, hrLog: null, ticketLog: null,
      transcripts: null, welcome: null, suggestions: null, staffFeedback: null
    },
    tickets: {
      supportCategory: null, supportPing: null,
      highrankCategory: null, highrankPing: null,
      supportAccess: [],
      highrankAccess: [],
      supportStaff: [],
      highrankStaff: [],
      rules: 'Please review the Ticket Rules before proceeding to ensure your request is handled properly.',
      panelTitle: 'Need Assistance?',
      panelBody: 'Click the **Open a Ticket** button below to get started and open a support ticket.',
      counter: 0, open: {}
    },
    antinuke: { enabled: false, threshold: 5, windowMs: 10000, whitelist: [], counters: {}, watchlist: {} },
    automod: {
      slurEnabled: false, slurList: [], ghostPingEnabled: false,
      linkEnabled: false, linkWhitelist: [], ignoredChannelIds: []
    },
    commandPerms: {},
    customCommands: {},
    webhookUrl: null,
    dmTemplates: {
      accept: 'Accepted — {server}\nRank: {rank}\n{notes}',
      deny: 'Denied — {server}\nReason: {reason}',
      promote: 'Promoted — {server}\nNew rank: {rank}\n{notes}',
      demote: 'Demoted — {server}\nNew rank: {rank}\nReason: {reason}',
      infract: 'Infraction — {server}\nType: {type}\nReason: {reason}'
    },
    acceptRoleIds: [],
    modHistory: {},
    robloxLogs: {},
    dailyCaps: {},
    suggestions: {},
    feedback: {}
  };
}

// ============================================================================
// DEEP MERGE
// ============================================================================

function deepMerge(target, source) {
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(target[key] || {}, source[key]);
    } else if (out[key] === undefined) {
      out[key] = source[key];
    }
  }
  return out;
}

// ============================================================================
// CONFIG LOAD / SAVE
// ============================================================================

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    } else if (fs.existsSync(CONFIG_BAK)) {
      config = JSON.parse(fs.readFileSync(CONFIG_BAK, 'utf8'));
      console.warn('[config] Loaded from backup');
    } else {
      config = { guilds: {} };
    }
  } catch (e) {
    console.error('[config] Corrupt main file, trying backup:', e.message);
    try {
      config = fs.existsSync(CONFIG_BAK)
        ? JSON.parse(fs.readFileSync(CONFIG_BAK, 'utf8'))
        : { guilds: {} };
    } catch {
      config = { guilds: {} };
    }
  }
  if (!config.guilds) config.guilds = {};
}

function saveConfig() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const data = JSON.stringify(config, null, 2);
      fs.writeFileSync(CONFIG_TMP, data);
      if (fs.existsSync(CONFIG_PATH)) {
        try { fs.copyFileSync(CONFIG_PATH, CONFIG_BAK); } catch {}
      }
      fs.renameSync(CONFIG_TMP, CONFIG_PATH);
    } catch (e) {
      console.error('[config] Save failed:', e.message);
    }
    saveTimer = null;
  }, 250);
}

function flushConfig() {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  try {
    const data = JSON.stringify(config, null, 2);
    fs.writeFileSync(CONFIG_TMP, data);
    if (fs.existsSync(CONFIG_PATH)) {
      try { fs.copyFileSync(CONFIG_PATH, CONFIG_BAK); } catch {}
    }
    fs.renameSync(CONFIG_TMP, CONFIG_PATH);
  } catch (e) {
    console.error('[config] Flush failed:', e.message);
  }
}

function getGuildConfig(guildId) {
  if (!config.guilds[guildId]) {
    config.guilds[guildId] = defaultGuildConfig();
    guildConfigCache.set(guildId, config.guilds[guildId]);
    saveConfig();
    return config.guilds[guildId];
  }
  const cached = guildConfigCache.get(guildId);
  if (cached) return cached;
  const merged = deepMerge(defaultGuildConfig(), config.guilds[guildId]);
  config.guilds[guildId] = merged;
  guildConfigCache.set(guildId, merged);
  return merged;
}

function invalidateGuildCache(guildId) {
  if (guildId) guildConfigCache.delete(guildId);
  else guildConfigCache.clear();
}

// ============================================================================
// TIER / PERMISSIONS
// ============================================================================

function getMemberTiers(member) {
  if (!member || !member.guild) return new Set();
  const key = `${member.guild.id}:${member.id}`;
  const cached = tierCache.get(key);
  if (cached && Date.now() - cached.ts < 30000) return cached.tiers;

  const gc = getGuildConfig(member.guild.id);
  const tiers = new Set();
  if (member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)) {
    tiers.add('staff'); tiers.add('admin'); tiers.add('highrank'); tiers.add('management');
  } else {
    const roleIds = new Set(member.roles.cache.map(r => r.id));
    for (const tier of ['staff', 'admin', 'highrank', 'management']) {
      const list = gc.roles[tier] || [];
      if (list.some(id => roleIds.has(id))) tiers.add(tier);
    }
  }
  tierCache.set(key, { tiers, ts: Date.now() });
  return tiers;
}

function expandTiers(tiers) {
  const expanded = new Set();
  for (const t of tiers) {
    const inh = TIER_INHERITANCE[t];
    if (inh) inh.forEach(x => expanded.add(x));
    else expanded.add(t);
  }
  return expanded;
}

function canRunCommand(member, commandName) {
  if (!member || !member.guild) return false;
  const gc = getGuildConfig(member.guild.id);
  let required = gc.commandPerms[commandName];
  if (required === undefined) required = DEFAULT_COMMAND_PERMS[commandName] || ['management'];
  if (Array.isArray(required) && required.length === 0) return false;
  if (required.includes('everyone')) return true;
  if (member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const memberTiers = expandTiers(getMemberTiers(member));
  return required.some(t => memberTiers.has(t));
}

function canModerate(executor, target) {
  if (!executor || !target) return false;
  if (executor.id === target.id) return false;
  if (target.id === target.guild.ownerId) return false;
  if (executor.id === executor.guild.ownerId) return true;
  if (executor.permissions.has(PermissionFlagsBits.Administrator) &&
      !target.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const gc = getGuildConfig(executor.guild.id);
  if (gc.roles.exempt && gc.roles.exempt.some(id => target.roles.cache.has(id))) return false;
  return target.roles.highest.position < executor.roles.highest.position;
}

function canManageRole(member, role) {
  if (!member || !role) return false;
  if (member.id === member.guild.ownerId) return true;
  const botMember = member.guild.members.me;
  if (!botMember) return false;
  if (role.position >= member.roles.highest.position) return false;
  if (role.position >= botMember.roles.highest.position) return false;
  return true;
}

// ============================================================================
// DAILY CAPS
// ============================================================================

function getDayKey() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${d.getUTCMonth()}-${d.getUTCDate()}`;
}

function checkDailyCap(guildId, type) {
  const gc = getGuildConfig(guildId);
  const day = getDayKey();
  if (!gc.dailyCaps[day]) gc.dailyCaps[day] = { mutes: 0, kicks: 0, bans: 0 };
  const caps = { mutes: 15, kicks: 15, bans: 10 };
  return gc.dailyCaps[day][type] < caps[type];
}

function incrementDailyCap(guildId, type) {
  const gc = getGuildConfig(guildId);
  const day = getDayKey();
  if (!gc.dailyCaps[day]) gc.dailyCaps[day] = { mutes: 0, kicks: 0, bans: 0 };
  gc.dailyCaps[day][type]++;
  const keys = Object.keys(gc.dailyCaps);
  if (keys.length > 3) {
    keys.sort();
    for (let i = 0; i < keys.length - 2; i++) delete gc.dailyCaps[keys[i]];
  }
  saveConfig();
}

function addHistory(guildId, userId, entry) {
  const gc = getGuildConfig(guildId);
  if (!gc.modHistory[userId]) gc.modHistory[userId] = [];
  gc.modHistory[userId].unshift(entry);
  if (gc.modHistory[userId].length > 200) gc.modHistory[userId] = gc.modHistory[userId].slice(0, 200);
  saveConfig();
}

// ============================================================================
// WEBHOOK / BROADCAST
// ============================================================================

function sendWebhook(url, embed, guild) {
  if (!url) return Promise.resolve();
  return new Promise((resolve) => {
    try {
      const u = new URL(url);
      const payload = JSON.stringify({
        username: guild ? guild.name : 'Mod Log',
        avatar_url: guild?.iconURL({ size: 64 }) || undefined,
        embeds: [embed.toJSON ? embed.toJSON() : embed]
      });
      const lib = u.protocol === 'https:' ? https : http;
      const req = lib.request({
        hostname: u.hostname,
        path: u.pathname + u.search,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }
      }, (res) => { res.on('data', () => {}); res.on('end', resolve); });
      req.on('error', () => resolve());
      req.write(payload);
      req.end();
    } catch { resolve(); }
  });
}

async function broadcast(guild, embed, targets) {
  if (!guild || !embed) return;
  const gc = getGuildConfig(guild.id);
  const jobs = [];
  for (const t of targets) {
    if (t === 'log' && gc.channels.log) {
      const ch = guild.channels.cache.get(gc.channels.log);
      if (ch) jobs.push(ch.send({ embeds: [embed] }).catch(() => {}));
    } else if (t === 'staff' && gc.channels.staffLog) {
      const ch = guild.channels.cache.get(gc.channels.staffLog);
      if (ch) jobs.push(ch.send({ embeds: [embed] }).catch(() => {}));
    } else if (t === 'hr' && gc.channels.hrLog) {
      const ch = guild.channels.cache.get(gc.channels.hrLog);
      if (ch) jobs.push(ch.send({ embeds: [embed] }).catch(() => {}));
    } else if (t === 'ticket' && gc.channels.ticketLog) {
      const ch = guild.channels.cache.get(gc.channels.ticketLog);
      if (ch) jobs.push(ch.send({ embeds: [embed] }).catch(() => {}));
    } else if (t === 'webhook' && gc.webhookUrl) {
      jobs.push(sendWebhook(gc.webhookUrl, embed, guild));
    }
  }
  await Promise.all(jobs);
}

// ============================================================================
// ANTINUKE
// ============================================================================

async function stripAllRoles(member) {
  const botMember = member.guild.members.me;
  if (!botMember) return;
  const botHighest = botMember.roles.highest.position;
  const toRemove = member.roles.cache.filter(r =>
    r.id !== member.guild.id &&
    !r.managed &&
    r.position < botHighest &&
    botMember.permissions.has(PermissionFlagsBits.ManageRoles)
  );
  if (toRemove.size > 0) await member.roles.remove(toRemove, 'Anti-nuke / watchlist').catch(() => {});
}

async function handleAntinukeEvent(guild, executorId, actionType) {
  if (!guild || !executorId) return;
  const gc = getGuildConfig(guild.id);
  if (!gc.antinuke.enabled) return;
  if (executorId === guild.ownerId || executorId === client.user.id) return;
  if (gc.antinuke.whitelist.includes(executorId)) return;

  const now = Date.now();
  if (!gc.antinuke.counters[executorId]) gc.antinuke.counters[executorId] = [];
  gc.antinuke.counters[executorId] = gc.antinuke.counters[executorId]
    .filter(t => now - t < gc.antinuke.windowMs);
  gc.antinuke.counters[executorId].push(now);
  saveConfig();

  if (gc.antinuke.counters[executorId].length >= gc.antinuke.threshold) {
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (member) {
      await stripAllRoles(member);
      if (member.kickable) await member.kick('Anti-nuke triggered').catch(() => {});
    }
    gc.antinuke.watchlist[executorId] = now + 24 * 60 * 60 * 1000;
    gc.antinuke.counters[executorId] = [];
    saveConfig();

    const embed = new EmbedBuilder()
      .setTitle('Anti-nuke fired')
      .setDescription(`User: <@${executorId}> (${executorId})\nAction: ${actionType}\nRoles stripped, kicked, watchlisted 24h`)
      .setColor(0xFF0000).setTimestamp();
    await broadcast(guild, embed, ['log', 'staff', 'webhook']);
    try {
      const user = await client.users.fetch(executorId);
      await user.send(`Anti-nuke — ${guild.name}\nYour roles were stripped and you were removed.`).catch(() => {});
    } catch {}
    try {
      const owner = await client.users.fetch(guild.ownerId);
      await owner.send(`Anti-nuke — ${guild.name}\nTriggered on <@${executorId}> (${executorId}) for ${actionType}`).catch(() => {});
    } catch {}
  }
}

async function processAuditAntinuke(guild, type, auditType) {
  try {
    const logs = await guild.fetchAuditLogs({ type: auditType, limit: 1 });
    const entry = logs.entries.first();
    if (!entry || Date.now() - entry.createdTimestamp > 5000) return;
    await handleAntinukeEvent(guild, entry.executor?.id, type);
  } catch {}
}

// ============================================================================
// MODERATION ACTIONS
// ============================================================================

async function doMute(executor, target, durationMs, reason) {
  if (!canModerate(executor, target)) return { ok: false, msg: 'Cannot moderate this member.' };
  if (!target.moderatable) return { ok: false, msg: 'Member is not moderatable.' };
  if (!checkDailyCap(executor.guild.id, 'mutes')) return { ok: false, msg: 'Daily mute cap reached.' };
  const ms = durationMs || 60 * 60 * 1000;
  await target.timeout(ms, reason || 'No reason');
  incrementDailyCap(executor.guild.id, 'mutes');
  addHistory(executor.guild.id, target.id, {
    type: 'mute', moderator: executor.user.tag, moderatorId: executor.id,
    reason: reason || 'No reason', duration: ms, at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Mute')
    .setDescription(`Target: ${target.user.tag} (${target.id})\nModerator: ${executor.user.tag}\nDuration: ${Math.round(ms / 60000)}m\nReason: ${reason || 'No reason'}`)
    .setColor(0xFFAA00).setTimestamp();
  await broadcast(executor.guild, embed, ['log', 'staff', 'webhook']);
  await target.send(`Muted — ${executor.guild.name}\nDuration: ${Math.round(ms / 60000)}m\n${reason || 'No reason'}`).catch(() => {});
  return { ok: true };
}

async function doUnmute(executor, target, reason) {
  if (!canModerate(executor, target)) return { ok: false, msg: 'Cannot moderate this member.' };
  await target.timeout(null, reason || 'Unmuted');
  addHistory(executor.guild.id, target.id, {
    type: 'unmute', moderator: executor.user.tag, moderatorId: executor.id,
    reason: reason || 'No reason', at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Unmute')
    .setDescription(`Target: ${target.user.tag}\nModerator: ${executor.user.tag}\nReason: ${reason || 'No reason'}`)
    .setColor(0x00AA00).setTimestamp();
  await broadcast(executor.guild, embed, ['log', 'staff', 'webhook']);
  return { ok: true };
}

async function doWarn(executor, target, reason) {
  if (!canModerate(executor, target)) return { ok: false, msg: 'Cannot moderate this member.' };
  addHistory(executor.guild.id, target.id, {
    type: 'warn', moderator: executor.user.tag, moderatorId: executor.id,
    reason: reason || 'No reason', at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Warn')
    .setDescription(`Target: ${target.user.tag}\nModerator: ${executor.user.tag}\nReason: ${reason || 'No reason'}`)
    .setColor(0xFFCC00).setTimestamp();
  await broadcast(executor.guild, embed, ['log', 'staff', 'webhook']);
  await target.send(`Warning — ${executor.guild.name}\n${reason || 'No reason'}`).catch(() => {});
  return { ok: true };
}

async function doKick(executor, target, reason) {
  if (!canModerate(executor, target)) return { ok: false, msg: 'Cannot moderate this member.' };
  if (!target.kickable) return { ok: false, msg: 'Member is not kickable.' };
  if (!checkDailyCap(executor.guild.id, 'kicks')) return { ok: false, msg: 'Daily kick cap reached.' };
  await target.send(`Kicked — ${executor.guild.name}\n${reason || 'No reason'}`).catch(() => {});
  await target.kick(reason || 'No reason');
  incrementDailyCap(executor.guild.id, 'kicks');
  addHistory(executor.guild.id, target.id, {
    type: 'kick', moderator: executor.user.tag, moderatorId: executor.id,
    reason: reason || 'No reason', at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Kick')
    .setDescription(`Target: ${target.user.tag}\nModerator: ${executor.user.tag}\nReason: ${reason || 'No reason'}`)
    .setColor(0xFF6600).setTimestamp();
  await broadcast(executor.guild, embed, ['log', 'staff', 'webhook']);
  await handleAntinukeEvent(executor.guild, executor.id, 'kick');
  return { ok: true };
}

async function doBan(executor, targetOrId, reason, deleteDays = 0) {
  const guild = executor.guild;
  let targetMember = null, targetId = null, targetTag = null;

  if (typeof targetOrId === 'string' || typeof targetOrId === 'number') {
    targetId = String(targetOrId);
    targetMember = await guild.members.fetch(targetId).catch(() => null);
    if (targetMember) {
      if (!canModerate(executor, targetMember)) return { ok: false, msg: 'Cannot moderate this member.' };
      if (!targetMember.bannable) return { ok: false, msg: 'Member is not bannable.' };
      targetTag = targetMember.user.tag;
    } else {
      const user = await client.users.fetch(targetId).catch(() => null);
      targetTag = user ? user.tag : targetId;
    }
  } else {
    targetMember = targetOrId;
    targetId = targetMember.id;
    targetTag = targetMember.user.tag;
    if (!canModerate(executor, targetMember)) return { ok: false, msg: 'Cannot moderate this member.' };
    if (!targetMember.bannable) return { ok: false, msg: 'Member is not bannable.' };
  }
  if (!checkDailyCap(guild.id, 'bans')) return { ok: false, msg: 'Daily ban cap reached.' };

  if (targetMember) await targetMember.send(`Banned — ${guild.name}\n${reason || 'No reason'}`).catch(() => {});
  await guild.members.ban(targetId, {
    reason: reason || 'No reason',
    deleteMessageSeconds: Math.min(deleteDays, 7) * 86400
  });
  incrementDailyCap(guild.id, 'bans');
  addHistory(guild.id, targetId, {
    type: 'ban', moderator: executor.user.tag, moderatorId: executor.id,
    reason: reason || 'No reason', at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Ban')
    .setDescription(`Target: ${targetTag} (${targetId})\nModerator: ${executor.user.tag}\nReason: ${reason || 'No reason'}`)
    .setColor(0xCC0000).setTimestamp();
  await broadcast(guild, embed, ['log', 'staff', 'webhook']);
  await handleAntinukeEvent(guild, executor.id, 'ban');
  return { ok: true };
}

async function doUnban(executor, userId, reason) {
  const guild = executor.guild;
  await guild.members.unban(userId, reason || 'Unbanned');
  addHistory(guild.id, userId, {
    type: 'unban', moderator: executor.user.tag, moderatorId: executor.id,
    reason: reason || 'No reason', at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Unban')
    .setDescription(`Target: ${userId}\nModerator: ${executor.user.tag}\nReason: ${reason || 'No reason'}`)
    .setColor(0x00AA00).setTimestamp();
  await broadcast(guild, embed, ['log', 'staff', 'webhook']);
  return { ok: true };
}

async function doLogUser(executor, robloxUsername, reason) {
  const gc = getGuildConfig(executor.guild.id);
  if (!gc.robloxLogs[robloxUsername]) gc.robloxLogs[robloxUsername] = [];
  gc.robloxLogs[robloxUsername].unshift({
    moderator: executor.user.tag, moderatorId: executor.id,
    reason: reason || 'No reason', at: Date.now()
  });
  if (gc.robloxLogs[robloxUsername].length > 100) {
    gc.robloxLogs[robloxUsername] = gc.robloxLogs[robloxUsername].slice(0, 100);
  }
  saveConfig();
  const embed = new EmbedBuilder().setTitle('Roblox log')
    .setDescription(`Username: ${robloxUsername}\nModerator: ${executor.user.tag}\nReason: ${reason || 'No reason'}`)
    .setColor(0x5865F2).setTimestamp();
  await broadcast(executor.guild, embed, ['log', 'staff', 'webhook']);
  return { ok: true };
}

// ============================================================================
// HR ACTIONS
// ============================================================================

function applyTemplate(template, vars) {
  let s = template || '';
  for (const [k, v] of Object.entries(vars)) {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), v || '');
  }
  return s;
}

async function doAccept(executor, target, rank, notes) {
  const gc = getGuildConfig(executor.guild.id);
  const roleIds = [
    ...(gc.acceptRoleIds || []),
    ...(Array.isArray(gc.roles.accept) ? gc.roles.accept : [])
  ];
  const seen = new Set();
  for (const rid of roleIds) {
    if (seen.has(rid)) continue;
    seen.add(rid);
    const role = executor.guild.roles.cache.get(rid);
    if (role && canManageRole(executor, role)) await target.roles.add(role).catch(() => {});
  }
  const msg = applyTemplate(gc.dmTemplates.accept, {
    server: executor.guild.name, rank: rank || '', type: 'accept', reason: '', notes: notes || ''
  });
  await target.send(msg).catch(() => {});
  addHistory(executor.guild.id, target.id, {
    type: 'accept', moderator: executor.user.tag, moderatorId: executor.id,
    rank, notes, at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Accept')
    .setDescription(`Target: ${target.user.tag}\nBy: ${executor.user.tag}\nRank: ${rank || '—'}\n${notes || ''}`)
    .setColor(0x00AA00).setTimestamp();
  await broadcast(executor.guild, embed, ['hr', 'log', 'webhook']);
  return { ok: true };
}

async function doDeny(executor, target, reason) {
  const gc = getGuildConfig(executor.guild.id);
  const msg = applyTemplate(gc.dmTemplates.deny, {
    server: executor.guild.name, rank: '', type: 'deny', reason: reason || '', notes: ''
  });
  await target.send(msg).catch(() => {});
  addHistory(executor.guild.id, target.id, {
    type: 'deny', moderator: executor.user.tag, moderatorId: executor.id,
    reason: reason || 'No reason', at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Deny')
    .setDescription(`Target: ${target.user.tag}\nBy: ${executor.user.tag}\nReason: ${reason || 'No reason'}`)
    .setColor(0xCC0000).setTimestamp();
  await broadcast(executor.guild, embed, ['hr', 'log', 'webhook']);
  return { ok: true };
}

async function doPromote(executor, target, rank, notes, role) {
  if (role) {
    if (!canManageRole(executor, role)) return { ok: false, msg: 'Cannot manage that role.' };
    await target.roles.add(role).catch(() => {});
  }
  const gc = getGuildConfig(executor.guild.id);
  const msg = applyTemplate(gc.dmTemplates.promote, {
    server: executor.guild.name, rank: rank || role?.name || '', type: 'promote', reason: '', notes: notes || ''
  });
  await target.send(msg).catch(() => {});
  addHistory(executor.guild.id, target.id, {
    type: 'promote', moderator: executor.user.tag, moderatorId: executor.id,
    rank, notes, roleId: role?.id, at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Promote')
    .setDescription(`Target: ${target.user.tag}\nBy: ${executor.user.tag}\nRank: ${rank || role?.name || '—'}\n${notes || ''}`)
    .setColor(0x00AA00).setTimestamp();
  await broadcast(executor.guild, embed, ['hr', 'log', 'webhook']);
  return { ok: true };
}

async function doDemote(executor, target, rank, reason, role) {
  if (role) {
    if (!canManageRole(executor, role)) return { ok: false, msg: 'Cannot manage that role.' };
    await target.roles.remove(role).catch(() => {});
  }
  const gc = getGuildConfig(executor.guild.id);
  const msg = applyTemplate(gc.dmTemplates.demote, {
    server: executor.guild.name, rank: rank || role?.name || '', type: 'demote', reason: reason || '', notes: ''
  });
  await target.send(msg).catch(() => {});
  addHistory(executor.guild.id, target.id, {
    type: 'demote', moderator: executor.user.tag, moderatorId: executor.id,
    rank, reason, roleId: role?.id, at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Demote')
    .setDescription(`Target: ${target.user.tag}\nBy: ${executor.user.tag}\nRank: ${rank || role?.name || '—'}\nReason: ${reason || 'No reason'}`)
    .setColor(0xFF6600).setTimestamp();
  await broadcast(executor.guild, embed, ['hr', 'log', 'webhook']);
  return { ok: true };
}

async function doInfract(executor, target, type, reason) {
  const gc = getGuildConfig(executor.guild.id);
  const msg = applyTemplate(gc.dmTemplates.infract, {
    server: executor.guild.name, rank: '', type: type || 'infraction', reason: reason || '', notes: ''
  });
  await target.send(msg).catch(() => {});
  addHistory(executor.guild.id, target.id, {
    type: 'infract', infractType: type, moderator: executor.user.tag, moderatorId: executor.id,
    reason: reason || 'No reason', at: Date.now()
  });
  const embed = new EmbedBuilder().setTitle('Infraction')
    .setDescription(`Target: ${target.user.tag}\nBy: ${executor.user.tag}\nType: ${type || '—'}\nReason: ${reason || 'No reason'}`)
    .setColor(0xFFAA00).setTimestamp();
  await broadcast(executor.guild, embed, ['hr', 'log', 'webhook']);
  return { ok: true };
}

// ============================================================================
// AUTOMOD
// ============================================================================

function getSlurRegex(guildId) {
  const gc = getGuildConfig(guildId);
  const list = gc.automod.slurList || [];
  const hash = crypto.createHash('md5').update(JSON.stringify(list)).digest('hex');
  if (slurRegexCache.has(hash)) return slurRegexCache.get(hash);
  if (list.length === 0) { slurRegexCache.set(hash, null); return null; }
  const escaped = list.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const re = new RegExp(`\\b(${escaped.join('|')})\\b`, 'i');
  slurRegexCache.set(hash, re);
  return re;
}

const LINK_REGEX = /https?:\/\/|www\.|discord\.gg\//i;

async function runAutomod(message, isUpdate = false) {
  if (!message.guild || message.author.bot) return false;
  const gc = getGuildConfig(message.guild.id);
  if (gc.automod.ignoredChannelIds?.includes(message.channel.id)) return false;

  if (gc.automod.slurEnabled) {
    const re = getSlurRegex(message.guild.id);
    if (re && re.test(message.content)) {
      automodDeletedIds.add(message.id);
      setTimeout(() => automodDeletedIds.delete(message.id), 15000);
      await message.delete().catch(() => {});
      const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
      if (member && member.moderatable) await member.timeout(60 * 60 * 1000, 'Slur filter').catch(() => {});
      const embed = new EmbedBuilder().setTitle('Slur filter triggered')
        .setDescription(`User: ${message.author.tag} (${message.author.id})\nChannel: <#${message.channel.id}>\nContent: ${message.content.slice(0, 500)}`)
        .setColor(0xFF0000).setTimestamp();
      const ping = gc.roles.hrPing ? `<@&${gc.roles.hrPing}>` : '';
      if (gc.channels.staffLog) {
        const ch = message.guild.channels.cache.get(gc.channels.staffLog);
        if (ch) await ch.send({ content: ping, embeds: [embed] }).catch(() => {});
      }
      await broadcast(message.guild, embed, ['log', 'webhook']);
      return true;
    }
  }

  if (gc.automod.linkEnabled && !gc.automod.linkWhitelist?.includes(message.channel.id)) {
    if (LINK_REGEX.test(message.content)) {
      automodDeletedIds.add(message.id);
      setTimeout(() => automodDeletedIds.delete(message.id), 15000);
      await message.delete().catch(() => {});
      await message.channel.send(`${message.author} — links are not allowed here.`)
        .then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
      return true;
    }
  }

  if (gc.automod.ghostPingEnabled && !isUpdate) {
    const mentions = [...message.mentions.users.keys()].filter(id => id !== message.author.id);
    if (mentions.length > 0) {
      ghostPingTracker.set(message.id, {
        authorId: message.author.id, guildId: message.guild.id, channelId: message.channel.id,
        mentions, content: message.content, expires: Date.now() + 60000
      });
    }
  }
  return false;
}

// ============================================================================
// TICKETS
// ============================================================================

function memberCanOpenTicket(member, type) {
  if (!member) return false;
  if (member.id === member.guild.ownerId || member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  const gc = getGuildConfig(member.guild.id);
  const access = type === 'highrank'
    ? (gc.tickets.highrankAccess || [])
    : (gc.tickets.supportAccess || []);
  if (!access.length) return true;
  return access.some(id => member.roles.cache.has(id));
}

function staffRolesForTicketType(gc, type) {
  const custom = type === 'highrank'
    ? (gc.tickets.highrankStaff || [])
    : (gc.tickets.supportStaff || []);
  if (custom.length) return [...custom];
  if (type === 'highrank') {
    return [...(gc.roles.highrank || []), ...(gc.roles.management || [])];
  }
  return [
    ...(gc.roles.staff || []),
    ...(gc.roles.admin || []),
    ...(gc.roles.highrank || []),
    ...(gc.roles.management || [])
  ];
}

async function createTicket(guild, user, type, member) {
  const gc = getGuildConfig(guild.id);
  const mem = member || await guild.members.fetch(user.id).catch(() => null);
  if (mem && !memberCanOpenTicket(mem, type)) {
    return { ok: false, msg: 'You do not have access to open this ticket type.' };
  }

  for (const [tid, t] of Object.entries(gc.tickets.open || {})) {
    if (t.userId === user.id && !t.closed) {
      const ch = guild.channels.cache.get(t.channelId);
      if (ch) return { ok: false, msg: `You already have an open ticket: <#${t.channelId}>` };
      t.closed = true; t.closedAt = Date.now(); saveConfig();
    }
  }

  const catId = type === 'highrank' ? gc.tickets.highrankCategory : gc.tickets.supportCategory;
  const pingId = type === 'highrank' ? gc.tickets.highrankPing : gc.tickets.supportPing;
  if (!catId) return { ok: false, msg: 'Ticket category not configured.' };
  const category = guild.channels.cache.get(catId);
  if (!category) return { ok: false, msg: 'Ticket category not found.' };

  gc.tickets.counter = (gc.tickets.counter || 0) + 1;
  const num = gc.tickets.counter;
  const slug = type === 'highrank' ? 'hr' : 'support';
  const uname = user.username.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'user';
  const name = `${num}-${slug}-${uname}`.slice(0, 100);

  const overwrites = [
    { id: guild.id, type: OverwriteType.Role, deny: [PermissionFlagsBits.ViewChannel] },
    { id: user.id, type: OverwriteType.Member, allow: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles
    ]},
    { id: client.user.id, type: OverwriteType.Member, allow: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages
    ]}
  ];
  if (pingId) {
    overwrites.push({ id: pingId, type: OverwriteType.Role, allow: [
      PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory
    ]});
  }
  for (const rid of staffRolesForTicketType(gc, type)) {
    if (!overwrites.find(o => o.id === rid)) {
      overwrites.push({ id: rid, type: OverwriteType.Role, allow: [
        PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory
      ]});
    }
  }

  const channel = await guild.channels.create({
    name, type: ChannelType.GuildText, parent: catId, permissionOverwrites: overwrites
  });

  const ticketId = `${guild.id}-${num}`;
  gc.tickets.open[ticketId] = {
    channelId: channel.id, userId: user.id, type, number: num,
    claimedBy: null, closed: false, createdAt: Date.now()
  };
  saveConfig();

  const welcome = new EmbedBuilder().setTitle('Ticket opened')
    .setDescription(`${user} — ${type} ticket.\nDescribe your issue below.`)
    .setColor(0xE67E22).setFooter({ text: `#${num}` }).setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ticket_close_${ticketId}`).setLabel('Close').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ticket_claim_${ticketId}`).setLabel('Claim').setStyle(ButtonStyle.Primary)
  );

  const ping = pingId ? `<@&${pingId}>` : '';
  await channel.send({ content: `${user} ${ping}`, embeds: [welcome], components: [row] });

  const logEmbed = new EmbedBuilder().setTitle('Ticket opened')
    .setDescription(`User: ${user.tag}\nType: ${type}\nChannel: <#${channel.id}>\n#${num}`)
    .setColor(0xE67E22).setTimestamp();
  await broadcast(guild, logEmbed, ['ticket', 'webhook']);
  await user.send(`Ticket opened — ${guild.name}\n<#${channel.id}>`).catch(() => {});
  return { ok: true, channel };
}

async function closeTicket(guild, ticketId, closer, reason) {
  const gc = getGuildConfig(guild.id);
  const ticket = gc.tickets.open[ticketId];
  if (!ticket || ticket.closed) return { ok: false, msg: 'Ticket not found or already closed.' };
  const channel = guild.channels.cache.get(ticket.channelId);
  if (!channel) {
    ticket.closed = true; ticket.closedAt = Date.now(); saveConfig();
    return { ok: false, msg: 'Channel missing. Marked closed.' };
  }

  const messages = [];
  let lastId = null;
  for (let i = 0; i < 10; i++) {
    const opts = { limit: 100 };
    if (lastId) opts.before = lastId;
    const batch = await channel.messages.fetch(opts);
    if (batch.size === 0) break;
    batch.forEach(m => messages.push(m));
    lastId = batch.last().id;
    if (batch.size < 100) break;
  }
  messages.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const lines = messages.map(m =>
    `[${new Date(m.createdTimestamp).toISOString()}] ${m.author.tag}: ${m.content}${m.attachments.size ? ' [attachments]' : ''}`
  );
  const transcript = lines.join('\n') || '(empty)';
  const buf = Buffer.from(transcript, 'utf8');
  const attachment = new AttachmentBuilder(buf, { name: `transcript-${ticket.number}.txt` });

  if (gc.channels.transcripts) {
    const tch = guild.channels.cache.get(gc.channels.transcripts);
    if (tch) {
      await tch.send({
        content: `Transcript — ticket #${ticket.number} (${ticket.type})\nClosed by ${closer.user?.tag || closer.tag || closer.id}`,
        files: [attachment]
      }).catch(() => {});
    }
  }

  ticket.closed = true; ticket.closedAt = Date.now();
  ticket.closedBy = closer.id; ticket.closeReason = reason || '';
  saveConfig();

  const opener = await client.users.fetch(ticket.userId).catch(() => null);
  if (opener) await opener.send(`Ticket closed — ${guild.name}\n#${ticket.number}\n${reason || ''}`).catch(() => {});

  const logEmbed = new EmbedBuilder().setTitle('Ticket closed')
    .setDescription(`#${ticket.number} (${ticket.type})\nClosed by: ${closer.user?.tag || closer.tag}\nReason: ${reason || '—'}`)
    .setColor(0x990000).setTimestamp();
  await broadcast(guild, logEmbed, ['ticket', 'webhook']);

  setTimeout(() => channel.delete('Ticket closed').catch(() => {}), 5000);
  return { ok: true };
}

// ============================================================================
// SLASH COMMAND BUILDER
// ============================================================================

function buildSlashCommands(guildId) {
  const gc = getGuildConfig(guildId);
  const cmds = [
    { name: 'help', description: 'Show commands' },
    { name: 'ping', description: 'Latency' },
    { name: 'avatar', description: 'Show avatar', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'whois', description: 'User info', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'userinfo', description: 'User info', options: [{ name: 'user', type: 6, description: 'User', required: false }] },
    { name: 'serverinfo', description: 'Server info' },
    { name: 'mute', description: 'Timeout a member', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'duration', type: 3, description: 'Duration e.g. 10m 1h', required: false },
      { name: 'reason', type: 3, description: 'Reason', required: false }
    ]},
    { name: 'unmute', description: 'Remove timeout', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'reason', type: 3, description: 'Reason', required: false }
    ]},
    { name: 'warn', description: 'Warn a member', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'reason', type: 3, description: 'Reason', required: false }
    ]},
    { name: 'kick', description: 'Kick a member', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'reason', type: 3, description: 'Reason', required: false }
    ]},
    { name: 'ban', description: 'Ban a member or ID', options: [
      { name: 'user', type: 6, description: 'User', required: false },
      { name: 'userid', type: 3, description: 'User ID for hackban', required: false },
      { name: 'reason', type: 3, description: 'Reason', required: false },
      { name: 'days', type: 4, description: 'Delete message days 0-7', required: false }
    ]},
    { name: 'unban', description: 'Unban a user', options: [
      { name: 'userid', type: 3, description: 'User ID', required: true },
      { name: 'reason', type: 3, description: 'Reason', required: false }
    ]},
    { name: 'clear', description: 'Delete messages', options: [
      { name: 'amount', type: 4, description: '1-100', required: true },
      { name: 'user', type: 6, description: 'Filter by user', required: false }
    ]},
    { name: 'purge', description: 'Delete messages', options: [
      { name: 'amount', type: 4, description: '1-100', required: true }
    ]},
    { name: 'history', description: 'Mod history', options: [{ name: 'user', type: 6, description: 'User', required: true }] },
    { name: 'loguser', description: 'Log Roblox punishment', options: [
      { name: 'username', type: 3, description: 'Roblox username', required: true },
      { name: 'reason', type: 3, description: 'Reason', required: true }
    ]},
    { name: 'robloxhistory', description: 'Roblox log history', options: [{ name: 'username', type: 3, description: 'Roblox username', required: true }] },
    { name: 'addrole', description: 'Add a role', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'role', type: 8, description: 'Role', required: true }
    ]},
    { name: 'removerole', description: 'Remove a role', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'role', type: 8, description: 'Role', required: true }
    ]},
    { name: 'nickname', description: 'Set nickname', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'nick', type: 3, description: 'Nickname', required: true }
    ]},
    { name: 'ticket', description: 'Open a ticket', options: [
      { name: 'type', type: 3, description: 'Type', required: true, choices: [
        { name: 'support', value: 'support' },
        { name: 'highrank', value: 'highrank' }
      ]}
    ]},
    { name: 'close', description: 'Close current ticket', options: [{ name: 'reason', type: 3, description: 'Reason', required: false }] },
    { name: 'claim', description: 'Claim current ticket' },
    { name: 'unclaim', description: 'Unclaim current ticket' },
    { name: 'tadd', description: 'Add user to ticket', options: [{ name: 'user', type: 6, description: 'User', required: true }] },
    { name: 'tremove', description: 'Remove user from ticket', options: [{ name: 'user', type: 6, description: 'User', required: true }] },
    { name: 'accept', description: 'Accept application', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'rank', type: 3, description: 'Rank', required: false },
      { name: 'notes', type: 3, description: 'Notes', required: false }
    ]},
    { name: 'deny', description: 'Deny application', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'reason', type: 3, description: 'Reason', required: false }
    ]},
    { name: 'promote', description: 'Promote member', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'rank', type: 3, description: 'Rank name', required: false },
      { name: 'role', type: 8, description: 'Role to add', required: false },
      { name: 'notes', type: 3, description: 'Notes', required: false }
    ]},
    { name: 'demote', description: 'Demote member', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'rank', type: 3, description: 'Rank name', required: false },
      { name: 'role', type: 8, description: 'Role to remove', required: false },
      { name: 'reason', type: 3, description: 'Reason', required: false }
    ]},
    { name: 'infract', description: 'Issue infraction', options: [
      { name: 'user', type: 6, description: 'User', required: true },
      { name: 'type', type: 3, description: 'Type', required: true },
      { name: 'reason', type: 3, description: 'Reason', required: false }
    ]},
    { name: 'acceptsetup', description: 'Set accept roles', options: [{ name: 'roles', type: 3, description: 'Role IDs space-separated', required: true }] },
    { name: 'setup', description: 'Open setup menu' },
    { name: 'antinuke', description: 'Anti-nuke status' },
    { name: 'poll', description: 'Create a poll', options: [
      { name: 'question', type: 3, description: 'Question', required: true },
      { name: 'options', type: 3, description: 'Options separated by |', required: true },
      { name: 'duration', type: 4, description: 'Minutes', required: false }
    ]},
    { name: 'giveaway', description: 'Start a giveaway', options: [
      { name: 'prize', type: 3, description: 'Prize', required: true },
      { name: 'duration', type: 4, description: 'Minutes', required: true },
      { name: 'winners', type: 4, description: 'Winner count', required: false },
      { name: 'role', type: 8, description: 'Required role', required: false },
      { name: 'channel', type: 7, description: 'Channel', required: false }
    ]},
    { name: 'giveaway-end', description: 'End a giveaway', options: [{ name: 'messageid', type: 3, description: 'Message ID', required: true }] },
    { name: 'giveaway-reroll', description: 'Reroll giveaway', options: [{ name: 'messageid', type: 3, description: 'Message ID', required: true }] },
    { name: 'suggest', description: 'Submit a suggestion', options: [{ name: 'text', type: 3, description: 'Suggestion', required: true }] },
    { name: 'feedback', description: 'Staff feedback', options: [{ name: 'text', type: 3, description: 'Feedback', required: true }] },
    { name: 'suggestion-approve', description: 'Approve suggestion', options: [{ name: 'messageid', type: 3, description: 'Message ID', required: true }] },
    { name: 'suggestion-deny', description: 'Deny suggestion', options: [{ name: 'messageid', type: 3, description: 'Message ID', required: true }] }
  ];

  for (const [name, data] of Object.entries(gc.customCommands || {})) {
    if (data.enabled !== false && !RESERVED_COMMAND_NAMES.has(name.toLowerCase())) {
      cmds.push({
        name: name.toLowerCase().slice(0, 32),
        description: (data.response || 'Custom command').slice(0, 100)
      });
    }
  }
  return cmds;
}

function hashCommands(cmds) {
  return crypto.createHash('sha256').update(JSON.stringify(cmds)).digest('hex');
}

async function registerCommands(guild) {
  const cmds = buildSlashCommands(guild.id);
  const hash = hashCommands(cmds);
  if (slashCache.get(guild.id) === hash) return;
  try {
    await guild.commands.set(cmds);
    slashCache.set(guild.id, hash);
  } catch (e) {
    console.error(`[slash] Failed for ${guild.id}:`, e.message);
  }
}

// ============================================================================
// DURATION PARSER
// ============================================================================

function parseDuration(str) {
  if (!str) return 60 * 60 * 1000;
  const m = String(str).trim().match(/^(\d+)\s*(s|m|h|d)?$/i);
  if (!m) return 60 * 60 * 1000;
  const n = parseInt(m[1], 10);
  const u = (m[2] || 'm').toLowerCase();
  if (u === 's') return n * 1000;
  if (u === 'm') return n * 60 * 1000;
  if (u === 'h') return n * 60 * 60 * 1000;
  if (u === 'd') return n * 24 * 60 * 60 * 1000;
  return n * 60 * 1000;
}

// ============================================================================
// SETUP UI — MAIN
// ============================================================================

function setupMainEmbed(guild) {
  const gc = getGuildConfig(guild.id);
  const ch = (id) => id ? `<#${id}>` : '—';
  const roles = (arr) => (Array.isArray(arr) && arr.length) ? arr.map(id => `<@&${id}>`).join(', ') : '—';

  return new EmbedBuilder()
    .setTitle('⚙️ Setup Menu')
    .setDescription([
      `**Prefix:** \`${gc.prefix}\``,
      `**Anti-nuke:** ${gc.antinuke.enabled ? '🟢 on' : '🔴 off'} (threshold ${gc.antinuke.threshold})`,
      `**Slur filter:** ${gc.automod.slurEnabled ? '🟢 on' : '🔴 off'} (${(gc.automod.slurList || []).length} words)`,
      `**Ghost ping:** ${gc.automod.ghostPingEnabled ? '🟢 on' : '🔴 off'}`,
      `**Link filter:** ${gc.automod.linkEnabled ? '🟢 on' : '🔴 off'}`,
      `**Webhook:** ${gc.webhookUrl ? '🟢 set' : '—'}`,
      '',
      '**Channels**',
      `Log: ${ch(gc.channels.log)}`,
      `Staff log: ${ch(gc.channels.staffLog)}`,
      `HR log: ${ch(gc.channels.hrLog)}`,
      `Ticket log: ${ch(gc.channels.ticketLog)}`,
      `Transcripts: ${ch(gc.channels.transcripts)}`,
      `Suggestions: ${ch(gc.channels.suggestions)}`,
      `Staff feedback: ${ch(gc.channels.staffFeedback)}`,
      '',
      '**Roles**',
      `Staff: ${roles(gc.roles.staff)}`,
      `Admin: ${roles(gc.roles.admin)}`,
      `Highrank: ${roles(gc.roles.highrank)}`,
      `Management: ${roles(gc.roles.management)}`,
      `Exempt: ${roles(gc.roles.exempt)}`
    ].join('\n'))
    .setColor(0x5865F2);
}

function setupMainRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_channels').setLabel('Channels').setStyle(ButtonStyle.Primary).setEmoji('📁'),
      new ButtonBuilder().setCustomId('setup_roles').setLabel('Roles').setStyle(ButtonStyle.Primary).setEmoji('🎭'),
      new ButtonBuilder().setCustomId('setup_tickets').setLabel('Tickets').setStyle(ButtonStyle.Primary).setEmoji('🎫'),
      new ButtonBuilder().setCustomId('setup_antinuke').setLabel('Anti-nuke').setStyle(ButtonStyle.Primary).setEmoji('🛡️'),
      new ButtonBuilder().setCustomId('setup_automod').setLabel('Automod').setStyle(ButtonStyle.Primary).setEmoji('🤖')
    ),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_permissions').setLabel('Permissions').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup_customcmds').setLabel('Custom commands').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup_general').setLabel('General').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup_dmtemplates').setLabel('DM templates').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup_posttickets').setLabel('Post tickets').setStyle(ButtonStyle.Success)
    )
  ];
}

// ============================================================================
// SETUP BUTTON HANDLER
// ============================================================================

async function handleSetupButton(interaction) {
  const id = interaction.customId;
  const guild = interaction.guild;
  const gc = getGuildConfig(guild.id);

  // ---------- MAIN / BACK ----------
  if (id === 'setup_main' || id === 'setup_back') {
    await interaction.update({ embeds: [setupMainEmbed(guild)], components: setupMainRows() });
    return;
  }

  // ---------- CHANNELS ----------
  if (id === 'setup_channels') {
    const embed = new EmbedBuilder().setTitle('📁 Channels')
      .setDescription([
        'Use the dropdowns to set a channel or clear one.',
        '',
        `**Log:** ${gc.channels.log ? `<#${gc.channels.log}>` : '—'}`,
        `**Staff log:** ${gc.channels.staffLog ? `<#${gc.channels.staffLog}>` : '—'}`,
        `**HR log:** ${gc.channels.hrLog ? `<#${gc.channels.hrLog}>` : '—'}`,
        `**Ticket log:** ${gc.channels.ticketLog ? `<#${gc.channels.ticketLog}>` : '—'}`,
        `**Transcripts:** ${gc.channels.transcripts ? `<#${gc.channels.transcripts}>` : '—'}`,
        `**Welcome:** ${gc.channels.welcome ? `<#${gc.channels.welcome}>` : '—'}`,
        `**Suggestions:** ${gc.channels.suggestions ? `<#${gc.channels.suggestions}>` : '—'}`,
        `**Staff feedback:** ${gc.channels.staffFeedback ? `<#${gc.channels.staffFeedback}>` : '—'}`
      ].join('\n'))
      .setColor(0x5865F2);

    const channelSelect = new ChannelSelectMenuBuilder()
      .setCustomId('setup_channel_pick')
      .setPlaceholder('Pick a channel...')
      .setMinValues(1).setMaxValues(1)
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

    const purposeSelect = new StringSelectMenuBuilder()
      .setCustomId('setup_channel_purpose')
      .setPlaceholder('Assign it as...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Log').setValue('log'),
        new StringSelectMenuOptionBuilder().setLabel('Staff log').setValue('staffLog'),
        new StringSelectMenuOptionBuilder().setLabel('HR log').setValue('hrLog'),
        new StringSelectMenuOptionBuilder().setLabel('Ticket log').setValue('ticketLog'),
        new StringSelectMenuOptionBuilder().setLabel('Transcripts').setValue('transcripts'),
        new StringSelectMenuOptionBuilder().setLabel('Welcome').setValue('welcome'),
        new StringSelectMenuOptionBuilder().setLabel('Suggestions').setValue('suggestions'),
        new StringSelectMenuOptionBuilder().setLabel('Staff feedback').setValue('staffFeedback')
      );

    const clearSelect = new StringSelectMenuBuilder()
      .setCustomId('setup_channel_clear')
      .setPlaceholder('Clear a channel...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Log').setValue('log'),
        new StringSelectMenuOptionBuilder().setLabel('Staff log').setValue('staffLog'),
        new StringSelectMenuOptionBuilder().setLabel('HR log').setValue('hrLog'),
        new StringSelectMenuOptionBuilder().setLabel('Ticket log').setValue('ticketLog'),
        new StringSelectMenuOptionBuilder().setLabel('Transcripts').setValue('transcripts'),
        new StringSelectMenuOptionBuilder().setLabel('Welcome').setValue('welcome'),
        new StringSelectMenuOptionBuilder().setLabel('Suggestions').setValue('suggestions'),
        new StringSelectMenuOptionBuilder().setLabel('Staff feedback').setValue('staffFeedback')
      );

    await interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(channelSelect),
        new ActionRowBuilder().addComponents(purposeSelect),
        new ActionRowBuilder().addComponents(clearSelect),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('setup_back').setLabel('Back').setStyle(ButtonStyle.Danger)
        )
      ]
    });
    return;
  }

  // ---------- ROLES ----------
  if (id === 'setup_roles') {
    const fmt = (arr) => (Array.isArray(arr) && arr.length) ? arr.map(r => `<@&${r}>`).join(', ') : '—';
    const embed = new EmbedBuilder().setTitle('🎭 Roles')
      .setDescription([
        'Use the dropdowns to add roles to a tier or remove them.',
        '',
        `**Staff:** ${fmt(gc.roles.staff)}`,
        `**Admin:** ${fmt(gc.roles.admin)}`,
        `**Highrank:** ${fmt(gc.roles.highrank)}`,
        `**Management:** ${fmt(gc.roles.management)}`,
        `**Exempt:** ${fmt(gc.roles.exempt)}`,
        `**Accept (auto-granted):** ${fmt(gc.roles.accept)}`,
        `**HR ping:** ${gc.roles.hrPing ? `<@&${gc.roles.hrPing}>` : '—'}`
      ].join('\n'))
      .setColor(0x5865F2);

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('setup_role_pick')
      .setPlaceholder('Pick role(s) to add...')
      .setMinValues(1).setMaxValues(25);

    const tierSelect = new StringSelectMenuBuilder()
      .setCustomId('setup_role_tier')
      .setPlaceholder('Add to tier...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Staff').setValue('staff'),
        new StringSelectMenuOptionBuilder().setLabel('Admin').setValue('admin'),
        new StringSelectMenuOptionBuilder().setLabel('Highrank').setValue('highrank'),
        new StringSelectMenuOptionBuilder().setLabel('Management').setValue('management'),
        new StringSelectMenuOptionBuilder().setLabel('Exempt').setValue('exempt'),
        new StringSelectMenuOptionBuilder().setLabel('Accept').setValue('accept'),
        new StringSelectMenuOptionBuilder().setLabel('HR ping (single)').setValue('hrPing')
      );

    const removeSelect = new StringSelectMenuBuilder()
      .setCustomId('setup_role_remove')
      .setPlaceholder('Remove tier roles...')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Staff').setValue('staff'),
        new StringSelectMenuOptionBuilder().setLabel('Admin').setValue('admin'),
        new StringSelectMenuOptionBuilder().setLabel('Highrank').setValue('highrank'),
        new StringSelectMenuOptionBuilder().setLabel('Management').setValue('management'),
        new StringSelectMenuOptionBuilder().setLabel('Exempt').setValue('exempt'),
        new StringSelectMenuOptionBuilder().setLabel('Accept').setValue('accept'),
        new StringSelectMenuOptionBuilder().setLabel('HR ping').setValue('hrPing')
      );

    await interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(roleSelect),
        new ActionRowBuilder().addComponents(tierSelect),
        new ActionRowBuilder().addComponents(removeSelect),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('setup_back').setLabel('Back').setStyle(ButtonStyle.Danger)
        )
      ]
    });
    return;
  }

  // ---------- TICKETS ----------
  if (id === 'setup_tickets') {
    const fmtRoles = (arr) => (Array.isArray(arr) && arr.length) ? arr.map(r => `<@&${r}>`).join(', ') : 'everyone / default';
    const embed = new EmbedBuilder().setTitle('Tickets')
      .setDescription([
        `Support category: ${gc.tickets.supportCategory ? `<#${gc.tickets.supportCategory}>` : '—'}`,
        `Support ping: ${gc.tickets.supportPing ? `<@&${gc.tickets.supportPing}>` : '—'}`,
        `Support open access: ${fmtRoles(gc.tickets.supportAccess)}`,
        `Support staff roles: ${fmtRoles(gc.tickets.supportStaff)}`,
        '',
        `HR category: ${gc.tickets.highrankCategory ? `<#${gc.tickets.highrankCategory}>` : '—'}`,
        `HR ping: ${gc.tickets.highrankPing ? `<@&${gc.tickets.highrankPing}>` : '—'}`,
        `HR open access: ${fmtRoles(gc.tickets.highrankAccess)}`,
        `HR staff roles: ${fmtRoles(gc.tickets.highrankStaff)}`,
        '',
        `Rules: ${(gc.tickets.rules || '').slice(0, 120)}${(gc.tickets.rules || '').length > 120 ? '…' : ''}`
      ].join('\n'))
      .setColor(0xE67E22);

    const typeSelect = new StringSelectMenuBuilder()
      .setCustomId('setup_ticket_type')
      .setPlaceholder('What are you setting?')
      .addOptions(
        new StringSelectMenuOptionBuilder().setLabel('Support category').setValue('supportCat'),
        new StringSelectMenuOptionBuilder().setLabel('Support ping role').setValue('supportPing'),
        new StringSelectMenuOptionBuilder().setLabel('Support open access roles').setValue('supportAccess'),
        new StringSelectMenuOptionBuilder().setLabel('Support staff roles').setValue('supportStaff'),
        new StringSelectMenuOptionBuilder().setLabel('HR category').setValue('highrankCat'),
        new StringSelectMenuOptionBuilder().setLabel('HR ping role').setValue('highrankPing'),
        new StringSelectMenuOptionBuilder().setLabel('HR open access roles').setValue('highrankAccess'),
        new StringSelectMenuOptionBuilder().setLabel('HR staff roles').setValue('highrankStaff')
      );

    const catSelect = new ChannelSelectMenuBuilder()
      .setCustomId('setup_ticket_category')
      .setPlaceholder('Pick a category channel...')
      .setMinValues(1).setMaxValues(1)
      .addChannelTypes(ChannelType.GuildCategory);

    const roleSelect = new RoleSelectMenuBuilder()
      .setCustomId('setup_ticket_roles')
      .setPlaceholder('Pick role(s) for selected setting...')
      .setMinValues(1).setMaxValues(25);

    await interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(typeSelect),
        new ActionRowBuilder().addComponents(catSelect),
        new ActionRowBuilder().addComponents(roleSelect),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('setup_ticket_rules').setLabel('Edit rules text').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('setup_ticket_clear_access').setLabel('Clear access lists').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('setup_back').setLabel('Back').setStyle(ButtonStyle.Danger)
        )
      ]
    });
    return;
  }

  if (id === 'setup_ticket_rules') {
    const modal = new ModalBuilder().setCustomId('setup_ticket_rules_modal').setTitle('Ticket rules / panel text');
    modal.addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('title').setLabel('Panel title').setStyle(TextInputStyle.Short)
          .setRequired(true).setValue((gc.tickets.panelTitle || 'Need Assistance?').slice(0, 100))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('body').setLabel('Panel body').setStyle(TextInputStyle.Paragraph)
          .setRequired(true).setValue((gc.tickets.panelBody || '').slice(0, 1000))
      ),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('rules').setLabel('Ticket rules text').setStyle(TextInputStyle.Paragraph)
          .setRequired(true).setValue((gc.tickets.rules || '').slice(0, 1000))
      )
    );
    await interaction.showModal(modal);
    return;
  }

  if (id === 'setup_ticket_clear_access') {
    gc.tickets.supportAccess = [];
    gc.tickets.highrankAccess = [];
    gc.tickets.supportStaff = [];
    gc.tickets.highrankStaff = [];
    saveConfig();
    await interaction.reply({ content: 'Cleared all ticket access and staff role lists (defaults restored).', flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- ANTI-NUKE ----------
  if (id === 'setup_antinuke') {
    const embed = new EmbedBuilder().setTitle('🛡️ Anti-nuke')
      .setDescription([
        `**Enabled:** ${gc.antinuke.enabled}`,
        `**Threshold:** ${gc.antinuke.threshold} actions / ${gc.antinuke.windowMs}ms`,
        `**Whitelist:** ${gc.antinuke.whitelist.length ? gc.antinuke.whitelist.map(u => `<@${u}>`).join(', ') : '—'}`,
        `**Watchlist:** ${Object.keys(gc.antinuke.watchlist).length ? Object.keys(gc.antinuke.watchlist).map(u => `<@${u}>`).join(', ') : '—'}`
      ].join('\n'))
      .setColor(0xFF0000);

    const addSelect = new UserSelectMenuBuilder()
      .setCustomId('setup_an_wl_add')
      .setPlaceholder('Add users to whitelist...')
      .setMinValues(1).setMaxValues(25);

    const removeSelect = new UserSelectMenuBuilder()
      .setCustomId('setup_an_wl_remove')
      .setPlaceholder('Remove users from whitelist...')
      .setMinValues(1).setMaxValues(25);

    await interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(addSelect),
        new ActionRowBuilder().addComponents(removeSelect),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('setup_an_toggle').setLabel('Toggle').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('setup_an_threshold').setLabel('Threshold').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('setup_an_reset').setLabel('Reset counters').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId('setup_back').setLabel('Back').setStyle(ButtonStyle.Danger)
        )
      ]
    });
    return;
  }

  if (id === 'setup_an_toggle') {
    gc.antinuke.enabled = !gc.antinuke.enabled;
    saveConfig();
    await interaction.reply({ content: `Anti-nuke ${gc.antinuke.enabled ? 'enabled' : 'disabled'}`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (id === 'setup_an_threshold') {
    const modal = new ModalBuilder().setCustomId('setup_an_threshold_modal').setTitle('Anti-nuke threshold');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('threshold').setLabel('Threshold').setStyle(TextInputStyle.Short).setRequired(true).setValue(String(gc.antinuke.threshold))
    ));
    await interaction.showModal(modal);
    return;
  }
  if (id === 'setup_an_reset') {
    gc.antinuke.counters = {};
    saveConfig();
    await interaction.reply({ content: 'Counters reset', flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- AUTOMOD ----------
  if (id === 'setup_automod') {
    const embed = new EmbedBuilder().setTitle('Automod')
      .setDescription([
        `Slur filter: ${gc.automod.slurEnabled} (${(gc.automod.slurList || []).length} words)`,
        `Ghost ping: ${gc.automod.ghostPingEnabled}`,
        `Link filter: ${gc.automod.linkEnabled}`,
        `Link whitelist: ${(gc.automod.linkWhitelist || []).map(c => `<#${c}>`).join(', ') || '—'}`,
        `Ignored channels: ${(gc.automod.ignoredChannelIds || []).map(c => `<#${c}>`).join(', ') || '—'}`
      ].join('\n'))
      .setColor(0x5865F2);

    const linkWlAdd = new ChannelSelectMenuBuilder()
      .setCustomId('setup_am_linkwl_add')
      .setPlaceholder('Add to link whitelist...')
      .setMinValues(1).setMaxValues(25)
      .addChannelTypes(ChannelType.GuildText);

    const ignoreAdd = new ChannelSelectMenuBuilder()
      .setCustomId('setup_am_ignore_add')
      .setPlaceholder('Add to ignore list...')
      .setMinValues(1).setMaxValues(25)
      .addChannelTypes(ChannelType.GuildText);

    await interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('setup_am_slur_toggle').setLabel('Slur').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('setup_am_slur_edit').setLabel('Edit slurs').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('setup_am_ghost').setLabel('Ghost ping').setStyle(ButtonStyle.Primary),
          new ButtonBuilder().setCustomId('setup_am_link').setLabel('Link filter').setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder().addComponents(linkWlAdd),
        new ActionRowBuilder().addComponents(ignoreAdd),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('setup_am_lists').setLabel('Remove from lists').setStyle(ButtonStyle.Secondary),
          new ButtonBuilder().setCustomId('setup_back').setLabel('Back').setStyle(ButtonStyle.Danger)
        )
      ]
    });
    return;
  }

  if (id === 'setup_am_lists') {
    const embed = new EmbedBuilder().setTitle('Automod — remove channels')
      .setDescription('Select channels to remove from link whitelist or ignore list.')
      .setColor(0x5865F2);
    const linkWlRemove = new ChannelSelectMenuBuilder()
      .setCustomId('setup_am_linkwl_remove')
      .setPlaceholder('Remove from link whitelist...')
      .setMinValues(1).setMaxValues(25)
      .addChannelTypes(ChannelType.GuildText);
    const ignoreRemove = new ChannelSelectMenuBuilder()
      .setCustomId('setup_am_ignore_remove')
      .setPlaceholder('Remove from ignore list...')
      .setMinValues(1).setMaxValues(25)
      .addChannelTypes(ChannelType.GuildText);
    await interaction.update({
      embeds: [embed],
      components: [
        new ActionRowBuilder().addComponents(linkWlRemove),
        new ActionRowBuilder().addComponents(ignoreRemove),
        new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('setup_automod').setLabel('Back').setStyle(ButtonStyle.Danger)
        )
      ]
    });
    return;
  }

  if (id === 'setup_am_slur_toggle') {
    gc.automod.slurEnabled = !gc.automod.slurEnabled;
    saveConfig();
    await interaction.reply({ content: `Slur filter ${gc.automod.slurEnabled ? 'on' : 'off'}`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (id === 'setup_am_slur_edit') {
    const modal = new ModalBuilder().setCustomId('setup_am_slur_modal').setTitle('Slur list');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('slurs').setLabel('Words (comma-separated)').setStyle(TextInputStyle.Paragraph).setRequired(false).setValue((gc.automod.slurList || []).join(', '))
    ));
    await interaction.showModal(modal);
    return;
  }
  if (id === 'setup_am_ghost') {
    gc.automod.ghostPingEnabled = !gc.automod.ghostPingEnabled;
    saveConfig();
    await interaction.reply({ content: `Ghost ping ${gc.automod.ghostPingEnabled ? 'on' : 'off'}`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (id === 'setup_am_link') {
    gc.automod.linkEnabled = !gc.automod.linkEnabled;
    saveConfig();
    await interaction.reply({ content: `Link filter ${gc.automod.linkEnabled ? 'on' : 'off'}`, flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- PERMISSIONS ----------
  if (id === 'setup_permissions') {
    const groups = {
      general: ['help', 'ping', 'avatar', 'whois', 'userinfo', 'serverinfo'],
      moderation: ['mute', 'unmute', 'warn', 'kick', 'ban', 'unban', 'clear', 'purge', 'history', 'loguser', 'robloxhistory'],
      roles: ['addrole', 'removerole', 'nickname'],
      tickets: ['ticket', 'close', 'claim', 'unclaim', 'tadd', 'tremove'],
      hr: ['accept', 'deny', 'promote', 'demote', 'infract', 'acceptsetup'],
      other: ['setup', 'poll', 'giveaway', 'giveaway-end', 'giveaway-reroll', 'suggest', 'feedback', 'suggestion-approve', 'suggestion-deny']
    };
    const embed = new EmbedBuilder().setTitle('🔐 Permissions').setDescription('Select a group').setColor(0x5865F2);
    const row = new ActionRowBuilder().addComponents(
      ...Object.keys(groups).slice(0, 5).map(g =>
        new ButtonBuilder().setCustomId(`setup_perm_group_${g}`).setLabel(g).setStyle(ButtonStyle.Primary)
      )
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_back').setLabel('Back').setStyle(ButtonStyle.Danger)
    );
    await interaction.update({ embeds: [embed], components: [row, row2] });
    return;
  }

  if (id.startsWith('setup_perm_group_')) {
    const group = id.slice('setup_perm_group_'.length);
    const groups = {
      general: ['help', 'ping', 'avatar', 'whois', 'userinfo', 'serverinfo'],
      moderation: ['mute', 'unmute', 'warn', 'kick', 'ban', 'unban', 'clear', 'purge', 'history', 'loguser', 'robloxhistory'],
      roles: ['addrole', 'removerole', 'nickname'],
      tickets: ['ticket', 'close', 'claim', 'unclaim', 'tadd', 'tremove'],
      hr: ['accept', 'deny', 'promote', 'demote', 'infract', 'acceptsetup'],
      other: ['setup', 'poll', 'giveaway', 'giveaway-end', 'giveaway-reroll', 'suggest', 'feedback', 'suggestion-approve', 'suggestion-deny']
    };
    const cmds = groups[group] || [];
    const embed = new EmbedBuilder().setTitle(`🔐 Permissions — ${group}`).setDescription('Select a command').setColor(0x5865F2);
    const rows = [];
    for (let i = 0; i < cmds.length; i += 5) {
      const chunk = cmds.slice(i, i + 5);
      rows.push(new ActionRowBuilder().addComponents(
        ...chunk.map(c => new ButtonBuilder().setCustomId(`setup_perm_edit_${c}`).setLabel(c).setStyle(ButtonStyle.Secondary))
      ));
    }
    rows.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_permissions').setLabel('Back').setStyle(ButtonStyle.Danger)
    ));
    await interaction.update({ embeds: [embed], components: rows.slice(0, 5) });
    return;
  }

  if (id.startsWith('setup_perm_edit_')) {
    const cmd = id.slice('setup_perm_edit_'.length);
    const required = gc.commandPerms[cmd] !== undefined
      ? gc.commandPerms[cmd]
      : (DEFAULT_COMMAND_PERMS[cmd] || ['management']);
    const embed = new EmbedBuilder().setTitle(`🔐 Perm — ${cmd}`)
      .setDescription(`Current: ${Array.isArray(required) ? required.join(', ') : required}\nEmpty override = deny`)
      .setColor(0x5865F2);
    const tiers = ['everyone', 'staff', 'admin', 'highrank', 'management'];
    const row = new ActionRowBuilder().addComponents(
      ...tiers.map(t => new ButtonBuilder()
        .setCustomId(`setup_perm_toggle_${cmd}_${t}`)
        .setLabel(t)
        .setStyle(required.includes?.(t) ? ButtonStyle.Success : ButtonStyle.Secondary))
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`setup_perm_reset_${cmd}`).setLabel('Reset default').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('setup_permissions').setLabel('Back').setStyle(ButtonStyle.Secondary)
    );
    await interaction.update({ embeds: [embed], components: [row, row2] });
    return;
  }

  if (id.startsWith('setup_perm_toggle_')) {
    const rest = id.slice('setup_perm_toggle_'.length);
    const parts = rest.split('_');
    const tier = parts.pop();
    const cmd = parts.join('_');
    let current = gc.commandPerms[cmd];
    if (current === undefined) current = [...(DEFAULT_COMMAND_PERMS[cmd] || ['management'])];
    else current = [...current];
    if (tier === 'everyone') current = ['everyone'];
    else {
      current = current.filter(t => t !== 'everyone');
      if (current.includes(tier)) current = current.filter(t => t !== tier);
      else current.push(tier);
    }
    gc.commandPerms[cmd] = current;
    saveConfig();
    await interaction.reply({ content: `${cmd} → ${current.join(', ') || '(deny)'}`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (id.startsWith('setup_perm_reset_')) {
    const cmd = id.slice('setup_perm_reset_'.length);
    delete gc.commandPerms[cmd];
    saveConfig();
    await interaction.reply({ content: `Reset ${cmd} to default`, flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- CUSTOM COMMANDS ----------
  if (id === 'setup_customcmds') {
    const list = Object.keys(gc.customCommands || {});
    const embed = new EmbedBuilder().setTitle('💬 Custom commands')
      .setDescription(list.length ? list.map(n => `\`${n}\``).join(', ') : 'None')
      .setColor(0x5865F2);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_cc_add').setLabel('Add').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('setup_cc_delete').setLabel('Delete').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('setup_cc_clear').setLabel('Clear all').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('setup_back').setLabel('Back').setStyle(ButtonStyle.Secondary)
    );
    await interaction.update({ embeds: [embed], components: [row] });
    return;
  }

  if (id === 'setup_cc_add') {
    const modal = new ModalBuilder().setCustomId('setup_cc_add_modal').setTitle('Add custom command');
    modal.addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('response').setLabel('Response').setStyle(TextInputStyle.Paragraph).setRequired(true)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('type').setLabel('Type: text or embed').setStyle(TextInputStyle.Short).setRequired(false).setValue('text'))
    );
    await interaction.showModal(modal);
    return;
  }
  if (id === 'setup_cc_delete') {
    const modal = new ModalBuilder().setCustomId('setup_cc_del_modal').setTitle('Delete custom command');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('name').setLabel('Name').setStyle(TextInputStyle.Short).setRequired(true)
    ));
    await interaction.showModal(modal);
    return;
  }
  if (id === 'setup_cc_clear') {
    for (const name of Object.keys(gc.customCommands || {})) {
      try {
        const cmds = await guild.commands.fetch();
        const existing = cmds.find(c => c.name === name.toLowerCase());
        if (existing) await guild.commands.delete(existing.id);
      } catch {}
    }
    gc.customCommands = {};
    saveConfig();
    slashCache.delete(guild.id);
    await registerCommands(guild);
    await interaction.reply({ content: 'Cleared all custom commands', flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- GENERAL ----------
  if (id === 'setup_general') {
    const embed = new EmbedBuilder().setTitle('⚙️ General')
      .setDescription(`**Prefix:** \`${gc.prefix}\`\n**Webhook:** ${gc.webhookUrl ? 'set' : 'none'}`)
      .setColor(0x5865F2);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_gen_prefix').setLabel('Prefix').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setup_gen_webhook').setLabel('Webhook').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('setup_back').setLabel('Back').setStyle(ButtonStyle.Danger)
    );
    await interaction.update({ embeds: [embed], components: [row] });
    return;
  }

  if (id === 'setup_gen_prefix') {
    const modal = new ModalBuilder().setCustomId('setup_gen_prefix_modal').setTitle('Prefix');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('prefix').setLabel('Prefix').setStyle(TextInputStyle.Short).setRequired(true).setValue(gc.prefix || '!')
    ));
    await interaction.showModal(modal);
    return;
  }
  if (id === 'setup_gen_webhook') {
    const modal = new ModalBuilder().setCustomId('setup_gen_webhook_modal').setTitle('Webhook URL');
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('url').setLabel('Webhook URL').setStyle(TextInputStyle.Short).setRequired(false).setValue(gc.webhookUrl || '')
    ));
    await interaction.showModal(modal);
    return;
  }

  // ---------- DM TEMPLATES ----------
  if (id === 'setup_dmtemplates') {
    const embed = new EmbedBuilder().setTitle('📨 DM templates')
      .setDescription('Variables: {server} {rank} {type} {reason} {notes}')
      .setColor(0x5865F2);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_dm_accept').setLabel('Accept').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup_dm_deny').setLabel('Deny').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup_dm_promote').setLabel('Promote').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup_dm_demote').setLabel('Demote').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('setup_dm_infract').setLabel('Infract').setStyle(ButtonStyle.Secondary)
    );
    const row2 = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('setup_back').setLabel('Back').setStyle(ButtonStyle.Danger)
    );
    await interaction.update({ embeds: [embed], components: [row, row2] });
    return;
  }

  if (id.startsWith('setup_dm_')) {
    const key = id.slice('setup_dm_'.length);
    const modal = new ModalBuilder().setCustomId(`setup_dm_modal_${key}`).setTitle(`DM template — ${key}`);
    modal.addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('template').setLabel('Template').setStyle(TextInputStyle.Paragraph).setRequired(true).setValue(gc.dmTemplates[key] || '')
    ));
    await interaction.showModal(modal);
    return;
  }

  // ---------- POST TICKETS PANEL ----------
  if (id === 'setup_posttickets') {
    const title = gc.tickets.panelTitle || 'Need Assistance?';
    const body = gc.tickets.panelBody || 'Click the **Open a Ticket** button below to get started and open a support ticket.';
    const rules = gc.tickets.rules || 'Please review the Ticket Rules before proceeding to ensure your request is handled properly.';
    const embed = new EmbedBuilder()
      .setColor(0xE67E22)
      .setTitle(title)
      .setDescription([
        `**${guild.name} | Support Assistant**`,
        '',
        body,
        '',
        '**Server Rules**',
        rules
      ].join('\n'))
      .setFooter({ text: `${guild.name} | Support System` })
      .setTimestamp();
    if (guild.iconURL()) embed.setThumbnail(guild.iconURL({ size: 128 }));

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('ticket_panel_open').setLabel('Open a Ticket').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('ticket_panel_rules').setLabel('Ticket Rules').setStyle(ButtonStyle.Secondary)
    );
    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({ content: 'Panel posted', flags: MessageFlags.Ephemeral });
    return;
  }
}

// ============================================================================
// SETUP SELECT HANDLER — the new multi-select logic
// ============================================================================

async function handleSetupSelect(interaction) {
  const id = interaction.customId;
  const guild = interaction.guild;
  const gc = getGuildConfig(guild.id);

  // ---------- CHANNELS ----------
  if (id === 'setup_channel_pick') {
    const channelId = interaction.values[0];
    pendingSetupChannel.set(interaction.user.id, { channelId, expires: Date.now() + 120000 });
    await interaction.reply({
      content: `Selected <#${channelId}>. Now pick a purpose in the dropdown above.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (id === 'setup_channel_purpose') {
    const purpose = interaction.values[0];
    const pending = pendingSetupChannel.get(interaction.user.id);
    if (!pending || pending.expires < Date.now()) {
      pendingSetupChannel.delete(interaction.user.id);
      await interaction.reply({ content: 'Pick a channel first (top dropdown).', flags: MessageFlags.Ephemeral });
      return;
    }
    const channelId = pending.channelId;
    gc.channels[purpose] = channelId;
    pendingSetupChannel.delete(interaction.user.id);
    saveConfig();
    await interaction.reply({ content: `Set **${purpose}** → <#${channelId}>`, flags: MessageFlags.Ephemeral });
    await interaction.message.edit({ embeds: [setupChannelsEmbed(guild)] }).catch(() => {});
    return;
  }

  if (id === 'setup_channel_clear') {
    const purpose = interaction.values[0];
    gc.channels[purpose] = null;
    saveConfig();
    await interaction.reply({ content: `Cleared **${purpose}**`, flags: MessageFlags.Ephemeral });
    await interaction.message.edit({ embeds: [setupChannelsEmbed(guild)] }).catch(() => {});
    return;
  }

  // ---------- ROLES ----------
  if (id === 'setup_role_pick') {
    const roleIds = interaction.values;
    pendingSetupRoles.set(interaction.user.id, { roleIds, expires: Date.now() + 120000 });
    await interaction.reply({
      content: `Selected ${roleIds.map(r => `<@&${r}>`).join(', ')}. Now pick a tier in the dropdown above.`,
      flags: MessageFlags.Ephemeral
    });
    return;
  }

  if (id === 'setup_role_tier') {
    const tier = interaction.values[0];
    const pending = pendingSetupRoles.get(interaction.user.id);
    if (!pending || !pending.roleIds?.length || pending.expires < Date.now()) {
      pendingSetupRoles.delete(interaction.user.id);
      await interaction.reply({ content: 'Pick roles first (top dropdown).', flags: MessageFlags.Ephemeral });
      return;
    }
    const roleIds = pending.roleIds;
    if (tier === 'hrPing') {
      gc.roles.hrPing = roleIds[0];
    } else if (tier === 'accept') {
      if (!Array.isArray(gc.roles.accept)) gc.roles.accept = [];
      for (const r of roleIds) {
        if (!gc.roles.accept.includes(r)) gc.roles.accept.push(r);
      }
      gc.acceptRoleIds = [...new Set([...(gc.acceptRoleIds || []), ...roleIds])];
    } else {
      if (!Array.isArray(gc.roles[tier])) gc.roles[tier] = [];
      for (const r of roleIds) {
        if (!gc.roles[tier].includes(r)) gc.roles[tier].push(r);
      }
    }
    pendingSetupRoles.delete(interaction.user.id);
    saveConfig();
    tierCache.clear();
    await interaction.reply({ content: `Added ${roleIds.map(r => `<@&${r}>`).join(', ')} to **${tier}**`, flags: MessageFlags.Ephemeral });
    await interaction.message.edit({ embeds: [setupRolesEmbed(guild)] }).catch(() => {});
    return;
  }

  if (id === 'setup_role_remove') {
    const tier = interaction.values[0];
    if (tier === 'hrPing') gc.roles.hrPing = null;
    else {
      gc.roles[tier] = [];
      if (tier === 'accept') gc.acceptRoleIds = [];
    }
    saveConfig();
    tierCache.clear();
    await interaction.reply({ content: `Cleared **${tier}**`, flags: MessageFlags.Ephemeral });
    await interaction.message.edit({ embeds: [setupRolesEmbed(guild)] }).catch(() => {});
    return;
  }

  // ---------- TICKETS ----------
  if (id === 'setup_ticket_type') {
    pendingSetupTicketType.set(interaction.user.id, { type: interaction.values[0], expires: Date.now() + 120000 });
    await interaction.reply({ content: `Selected **${interaction.values[0]}**. Now use the category or ping dropdown above.`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (id === 'setup_ticket_category') {
    const pending = pendingSetupTicketType.get(interaction.user.id);
    if (!pending || pending.expires < Date.now()) {
      pendingSetupTicketType.delete(interaction.user.id);
      await interaction.reply({ content: 'Pick a type first (top dropdown).', flags: MessageFlags.Ephemeral });
      return;
    }
    const type = pending.type;
    const catId = interaction.values[0];
    if (type === 'supportCat') gc.tickets.supportCategory = catId;
    else if (type === 'highrankCat') gc.tickets.highrankCategory = catId;
    else {
      await interaction.reply({ content: 'Pick Support or HR category type, not a ping type.', flags: MessageFlags.Ephemeral });
      return;
    }
    saveConfig();
    await interaction.reply({ content: `Set **${type}** → <#${catId}>`, flags: MessageFlags.Ephemeral });
    await interaction.message.edit({ embeds: [setupTicketsEmbed(guild)] }).catch(() => {});
    return;
  }

  if (id === 'setup_ticket_roles' || id === 'setup_ticket_ping') {
    const pending = pendingSetupTicketType.get(interaction.user.id);
    if (!pending || pending.expires < Date.now()) {
      pendingSetupTicketType.delete(interaction.user.id);
      await interaction.reply({ content: 'Pick a type first (top dropdown).', flags: MessageFlags.Ephemeral });
      return;
    }
    const type = pending.type;
    const roleIds = interaction.values;
    const roleId = roleIds[0];
    if (type === 'supportPing') {
      gc.tickets.supportPing = roleId;
    } else if (type === 'highrankPing') {
      gc.tickets.highrankPing = roleId;
    } else if (type === 'supportAccess') {
      gc.tickets.supportAccess = [...new Set([...(gc.tickets.supportAccess || []), ...roleIds])];
    } else if (type === 'highrankAccess') {
      gc.tickets.highrankAccess = [...new Set([...(gc.tickets.highrankAccess || []), ...roleIds])];
    } else if (type === 'supportStaff') {
      gc.tickets.supportStaff = [...new Set([...(gc.tickets.supportStaff || []), ...roleIds])];
    } else if (type === 'highrankStaff') {
      gc.tickets.highrankStaff = [...new Set([...(gc.tickets.highrankStaff || []), ...roleIds])];
    } else {
      await interaction.reply({ content: 'Pick a role-based setting (ping / access / staff), not a category.', flags: MessageFlags.Ephemeral });
      return;
    }
    saveConfig();
    await interaction.reply({
      content: `Set **${type}** → ${roleIds.map(r => `<@&${r}>`).join(', ')}`,
      flags: MessageFlags.Ephemeral
    });
    await interaction.message.edit({ embeds: [setupTicketsEmbed(guild)] }).catch(() => {});
    return;
  }

  // ---------- ANTI-NUKE ----------
  if (id === 'setup_an_wl_add') {
    for (const uid of interaction.values) {
      if (!gc.antinuke.whitelist.includes(uid)) gc.antinuke.whitelist.push(uid);
    }
    saveConfig();
    await interaction.reply({ content: `Added ${interaction.values.length} user(s) to whitelist.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (id === 'setup_an_wl_remove') {
    for (const uid of interaction.values) {
      gc.antinuke.whitelist = gc.antinuke.whitelist.filter(u => u !== uid);
    }
    saveConfig();
    await interaction.reply({ content: `Removed ${interaction.values.length} user(s) from whitelist.`, flags: MessageFlags.Ephemeral });
    return;
  }

  // ---------- AUTOMOD LISTS ----------
  if (id === 'setup_am_linkwl_add') {
    if (!gc.automod.linkWhitelist) gc.automod.linkWhitelist = [];
    for (const cid of interaction.values) {
      if (!gc.automod.linkWhitelist.includes(cid)) gc.automod.linkWhitelist.push(cid);
    }
    saveConfig();
    await interaction.reply({ content: `Added ${interaction.values.length} channel(s) to link whitelist.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (id === 'setup_am_linkwl_remove') {
    for (const cid of interaction.values) {
      gc.automod.linkWhitelist = (gc.automod.linkWhitelist || []).filter(c => c !== cid);
    }
    saveConfig();
    await interaction.reply({ content: `Removed ${interaction.values.length} channel(s) from link whitelist.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (id === 'setup_am_ignore_add') {
    if (!gc.automod.ignoredChannelIds) gc.automod.ignoredChannelIds = [];
    for (const cid of interaction.values) {
      if (!gc.automod.ignoredChannelIds.includes(cid)) gc.automod.ignoredChannelIds.push(cid);
    }
    saveConfig();
    await interaction.reply({ content: `Added ${interaction.values.length} channel(s) to ignore list.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (id === 'setup_am_ignore_remove') {
    for (const cid of interaction.values) {
      gc.automod.ignoredChannelIds = (gc.automod.ignoredChannelIds || []).filter(c => c !== cid);
    }
    saveConfig();
    await interaction.reply({ content: `Removed ${interaction.values.length} channel(s) from ignore list.`, flags: MessageFlags.Ephemeral });
    return;
  }
}

// Helpers to re-render the setup sub-embeds after a selection
function setupChannelsEmbed(guild) {
  const gc = getGuildConfig(guild.id);
  return new EmbedBuilder().setTitle('📁 Channels')
    .setDescription([
      `**Log:** ${gc.channels.log ? `<#${gc.channels.log}>` : '—'}`,
      `**Staff log:** ${gc.channels.staffLog ? `<#${gc.channels.staffLog}>` : '—'}`,
      `**HR log:** ${gc.channels.hrLog ? `<#${gc.channels.hrLog}>` : '—'}`,
      `**Ticket log:** ${gc.channels.ticketLog ? `<#${gc.channels.ticketLog}>` : '—'}`,
      `**Transcripts:** ${gc.channels.transcripts ? `<#${gc.channels.transcripts}>` : '—'}`,
      `**Welcome:** ${gc.channels.welcome ? `<#${gc.channels.welcome}>` : '—'}`,
      `**Suggestions:** ${gc.channels.suggestions ? `<#${gc.channels.suggestions}>` : '—'}`,
      `**Staff feedback:** ${gc.channels.staffFeedback ? `<#${gc.channels.staffFeedback}>` : '—'}`
    ].join('\n'))
    .setColor(0x5865F2);
}

function setupRolesEmbed(guild) {
  const gc = getGuildConfig(guild.id);
  const fmt = (arr) => (Array.isArray(arr) && arr.length) ? arr.map(r => `<@&${r}>`).join(', ') : '—';
  return new EmbedBuilder().setTitle('🎭 Roles')
    .setDescription([
      `**Staff:** ${fmt(gc.roles.staff)}`,
      `**Admin:** ${fmt(gc.roles.admin)}`,
      `**Highrank:** ${fmt(gc.roles.highrank)}`,
      `**Management:** ${fmt(gc.roles.management)}`,
      `**Exempt:** ${fmt(gc.roles.exempt)}`,
      `**Accept:** ${fmt(gc.roles.accept)}`,
      `**HR ping:** ${gc.roles.hrPing ? `<@&${gc.roles.hrPing}>` : '—'}`
    ].join('\n'))
    .setColor(0x5865F2);
}

function setupTicketsEmbed(guild) {
  const gc = getGuildConfig(guild.id);
  const fmtRoles = (arr) => (Array.isArray(arr) && arr.length) ? arr.map(r => `<@&${r}>`).join(', ') : 'everyone / default';
  return new EmbedBuilder().setTitle('Tickets')
    .setDescription([
      `Support category: ${gc.tickets.supportCategory ? `<#${gc.tickets.supportCategory}>` : '—'}`,
      `Support ping: ${gc.tickets.supportPing ? `<@&${gc.tickets.supportPing}>` : '—'}`,
      `Support open access: ${fmtRoles(gc.tickets.supportAccess)}`,
      `Support staff roles: ${fmtRoles(gc.tickets.supportStaff)}`,
      `HR category: ${gc.tickets.highrankCategory ? `<#${gc.tickets.highrankCategory}>` : '—'}`,
      `HR ping: ${gc.tickets.highrankPing ? `<@&${gc.tickets.highrankPing}>` : '—'}`,
      `HR open access: ${fmtRoles(gc.tickets.highrankAccess)}`,
      `HR staff roles: ${fmtRoles(gc.tickets.highrankStaff)}`
    ].join('\n'))
    .setColor(0xE67E22);
}

// ============================================================================
// MODAL HANDLER
// ============================================================================

async function handleModal(interaction) {
  const id = interaction.customId;
  const guild = interaction.guild;
  const gc = getGuildConfig(guild.id);

  if (id === 'setup_an_threshold_modal') {
    const val = parseInt(interaction.fields.getTextInputValue('threshold'), 10);
    if (!isNaN(val) && val > 0) {
      gc.antinuke.threshold = val;
      saveConfig();
      await interaction.reply({ content: `Threshold set to ${val}`, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: 'Invalid number', flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (id === 'setup_am_slur_modal') {
    const raw = interaction.fields.getTextInputValue('slurs') || '';
    gc.automod.slurList = raw.split(',').map(s => s.trim()).filter(Boolean);
    saveConfig();
    slurRegexCache.clear();
    await interaction.reply({ content: `Slur list updated (${gc.automod.slurList.length} words)`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (id === 'setup_cc_add_modal') {
    const name = interaction.fields.getTextInputValue('name').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 32);
    const response = interaction.fields.getTextInputValue('response');
    const type = (interaction.fields.getTextInputValue('type') || 'text').toLowerCase() === 'embed' ? 'embed' : 'text';
    if (!name || RESERVED_COMMAND_NAMES.has(name)) {
      await interaction.reply({ content: 'Invalid or reserved name', flags: MessageFlags.Ephemeral });
      return;
    }
    gc.customCommands[name] = { response, type, color: 0x5865F2, deleteTrigger: false, enabled: true };
    saveConfig();
    slashCache.delete(guild.id);
    await registerCommands(guild);
    await interaction.reply({ content: `Added /${name}`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (id === 'setup_cc_del_modal') {
    const name = interaction.fields.getTextInputValue('name').toLowerCase();
    if (gc.customCommands[name]) {
      delete gc.customCommands[name];
      saveConfig();
      try {
        const cmds = await guild.commands.fetch();
        const existing = cmds.find(c => c.name === name);
        if (existing) await guild.commands.delete(existing.id);
      } catch {}
      slashCache.delete(guild.id);
      await interaction.reply({ content: `Deleted ${name}`, flags: MessageFlags.Ephemeral });
    } else {
      await interaction.reply({ content: 'Not found', flags: MessageFlags.Ephemeral });
    }
    return;
  }

  if (id === 'setup_gen_prefix_modal') {
    const prefix = interaction.fields.getTextInputValue('prefix').slice(0, 5) || '!';
    gc.prefix = prefix;
    saveConfig();
    await interaction.reply({ content: `Prefix set to \`${prefix}\``, flags: MessageFlags.Ephemeral });
    return;
  }

  if (id === 'setup_gen_webhook_modal') {
    const url = interaction.fields.getTextInputValue('url') || null;
    gc.webhookUrl = url;
    saveConfig();
    await interaction.reply({ content: url ? 'Webhook set' : 'Webhook cleared', flags: MessageFlags.Ephemeral });
    return;
  }

  if (id.startsWith('setup_dm_modal_')) {
    const key = id.slice('setup_dm_modal_'.length);
    gc.dmTemplates[key] = interaction.fields.getTextInputValue('template');
    saveConfig();
    await interaction.reply({ content: `Template ${key} updated`, flags: MessageFlags.Ephemeral });
    return;
  }

  if (id === 'setup_ticket_rules_modal') {
    gc.tickets.panelTitle = interaction.fields.getTextInputValue('title').slice(0, 100);
    gc.tickets.panelBody = interaction.fields.getTextInputValue('body').slice(0, 2000);
    gc.tickets.rules = interaction.fields.getTextInputValue('rules').slice(0, 2000);
    saveConfig();
    await interaction.reply({ content: 'Ticket panel text updated', flags: MessageFlags.Ephemeral });
    return;
  }
}

// ============================================================================
// GIVEAWAY
// ============================================================================

async function endGiveaway(guild, messageId) {
  const key = `${guild.id}:${messageId}`;
  const g = giveawayStore.get(key);
  if (!g || g.ended) return;
  g.ended = true;
  g.endedAt = Date.now();
  giveawayStore.delete(key);
  endedGiveawayStore.set(key, g);
  setTimeout(() => endedGiveawayStore.delete(key), 60 * 60 * 1000);

  const entries = g.entries || [];
  const winnerCount = Math.min(g.winners || 1, entries.length);
  const winners = [];
  const pool = [...entries];
  for (let i = 0; i < winnerCount && pool.length; i++) {
    const idx = Math.floor(Math.random() * pool.length);
    winners.push(pool.splice(idx, 1)[0]);
  }
  g.lastWinners = winners;

  const channel = guild.channels.cache.get(g.channelId);
  if (channel) {
    const msg = await channel.messages.fetch(messageId).catch(() => null);
    const winnerMentions = winners.map(id => `<@${id}>`).join(', ') || 'No valid entries';
    const embed = new EmbedBuilder().setTitle('Giveaway ended')
      .setDescription(`Prize: ${g.prize}\nWinner: ${winnerMentions}`)
      .setColor(0x57F287).setTimestamp();
    if (msg) await msg.edit({ embeds: [embed], components: [] }).catch(() => {});
    await channel.send(`Winner: ${winnerMentions} — ${g.prize}`).catch(() => {});
  }
}

// ============================================================================
// COMMAND HANDLER
// ============================================================================

async function handleCommand(ctx) {
  const { guild, member, user, channel, commandName, options, isSlash, interaction, message, args } = ctx;
  const gc = getGuildConfig(guild.id);

  if (gc.customCommands?.[commandName] && gc.customCommands[commandName].enabled !== false) {
    const cc = gc.customCommands[commandName];
    if (cc.type === 'embed') {
      const embed = new EmbedBuilder().setDescription(cc.response).setColor(cc.color || 0x5865F2);
      if (isSlash) await interaction.editReply({ embeds: [embed] });
      else await channel.send({ embeds: [embed] });
    } else {
      if (isSlash) await interaction.editReply({ content: cc.response });
      else await channel.send(cc.response);
    }
    if (cc.deleteTrigger && message) await message.delete().catch(() => {});
    return;
  }

  if (!canRunCommand(member, commandName)) {
    const msg = 'No permission.';
    if (isSlash) await interaction.editReply({ content: msg });
    else await channel.send(msg);
    return;
  }

  const reply = async (content, embeds) => {
    const payload = {};
    if (typeof content === 'string') payload.content = content;
    else if (content?.embeds) Object.assign(payload, content);
    else if (embeds) payload.embeds = embeds;
    else payload.content = String(content);
    if (isSlash) await interaction.editReply(payload);
    else await channel.send(payload);
  };

  try {
    switch (commandName) {
      case 'help': {
        const cmds = Object.keys(DEFAULT_COMMAND_PERMS).filter(c => canRunCommand(member, c));
        const embed = new EmbedBuilder().setTitle('Commands')
          .setDescription(cmds.map(c => `\`${gc.prefix}${c}\` / \`/${c}\``).join('\n').slice(0, 4000))
          .setColor(0x5865F2);
        await reply(null, [embed]);
        break;
      }
      case 'ping': {
        const lat = isSlash ? Date.now() - interaction.createdTimestamp : client.ws.ping;
        await reply(`Pong — ${lat}ms (ws ${client.ws.ping}ms)`);
        break;
      }
      case 'avatar': {
        const u = options.user || user;
        const embed = new EmbedBuilder().setTitle(u.tag || u.username).setImage(u.displayAvatarURL({ size: 4096 })).setColor(0x5865F2);
        await reply(null, [embed]);
        break;
      }
      case 'whois':
      case 'userinfo': {
        const u = options.user || user;
        const m = options.member || (u.id === user.id ? member : await guild.members.fetch(u.id).catch(() => null));
        const embed = new EmbedBuilder().setTitle(u.tag || u.username).setThumbnail(u.displayAvatarURL())
          .addFields(
            { name: 'ID', value: u.id, inline: true },
            { name: 'Created', value: `<t:${Math.floor(u.createdTimestamp / 1000)}:R>`, inline: true },
            { name: 'Joined', value: m ? `<t:${Math.floor(m.joinedTimestamp / 1000)}:R>` : '—', inline: true },
            { name: 'Roles', value: m ? m.roles.cache.filter(r => r.id !== guild.id).map(r => r.name).slice(0, 15).join(', ') || '—' : '—', inline: false }
          ).setColor(0x5865F2);
        await reply(null, [embed]);
        break;
      }
      case 'serverinfo': {
        const embed = new EmbedBuilder().setTitle(guild.name).setThumbnail(guild.iconURL())
          .addFields(
            { name: 'Members', value: String(guild.memberCount), inline: true },
            { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
            { name: 'Roles', value: String(guild.roles.cache.size), inline: true },
            { name: 'Owner', value: `<@${guild.ownerId}>`, inline: true },
            { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:R>`, inline: true }
          ).setColor(0x5865F2);
        await reply(null, [embed]);
        break;
      }
      case 'mute': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        const dur = parseDuration(options.duration);
        const res = await doMute(member, target, dur, options.reason);
        await reply(res.ok ? `Muted ${target.user.tag}` : res.msg);
        break;
      }
      case 'unmute': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        const res = await doUnmute(member, target, options.reason);
        await reply(res.ok ? `Unmuted ${target.user.tag}` : res.msg);
        break;
      }
      case 'warn': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        const res = await doWarn(member, target, options.reason);
        await reply(res.ok ? `Warned ${target.user.tag}` : res.msg);
        break;
      }
      case 'kick': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        const res = await doKick(member, target, options.reason);
        await reply(res.ok ? `Kicked ${target.user.tag}` : res.msg);
        break;
      }
      case 'ban': {
        let res;
        if (options.member) res = await doBan(member, options.member, options.reason, options.days || 0);
        else if (options.userid) res = await doBan(member, options.userid, options.reason, options.days || 0);
        else { await reply('User or userid required'); break; }
        await reply(res.ok ? 'Banned' : res.msg);
        break;
      }
      case 'unban': {
        if (!options.userid) { await reply('User ID required'); break; }
        const res = await doUnban(member, options.userid, options.reason);
        await reply(res.ok ? 'Unbanned' : res.msg);
        break;
      }
      case 'clear':
      case 'purge': {
        const amount = Math.min(Math.max(parseInt(options.amount || args?.[0], 10) || 0, 1), 100);
        const fetched = await channel.messages.fetch({ limit: amount });
        let toDelete = fetched;
        if (options.user) toDelete = fetched.filter(m => m.author.id === options.user.id);
        const deleted = await channel.bulkDelete(toDelete, true).catch(() => null);
        await reply(`Deleted ${deleted?.size || 0} messages`);
        break;
      }
      case 'history': {
        const target = options.user || options.member?.user;
        if (!target) { await reply('User required'); break; }
        const hist = gc.modHistory[target.id] || [];
        const lines = hist.slice(0, 15).map(h => `\`${h.type}\` by ${h.moderator} — ${h.reason || ''} <t:${Math.floor(h.at / 1000)}:R>`);
        const embed = new EmbedBuilder().setTitle(`History — ${target.tag}`).setDescription(lines.join('\n') || 'None').setColor(0x5865F2);
        await reply(null, [embed]);
        break;
      }
      case 'loguser': {
        if (!options.username) { await reply('Username required'); break; }
        await doLogUser(member, options.username, options.reason);
        await reply(`Logged ${options.username}`);
        break;
      }
      case 'robloxhistory': {
        const uname = options.username;
        if (!uname) { await reply('Username required'); break; }
        const hist = gc.robloxLogs[uname] || [];
        const lines = hist.slice(0, 15).map(h => `${h.moderator} — ${h.reason} <t:${Math.floor(h.at / 1000)}:R>`);
        const embed = new EmbedBuilder().setTitle(`Roblox — ${uname}`).setDescription(lines.join('\n') || 'None').setColor(0x5865F2);
        await reply(null, [embed]);
        break;
      }
      case 'addrole': {
        const target = options.member;
        const role = options.role;
        if (!target || !role) { await reply('User and role required'); break; }
        if (!canManageRole(member, role)) { await reply('Cannot manage that role'); break; }
        await target.roles.add(role);
        await reply(`Added ${role.name} to ${target.user.tag}`);
        break;
      }
      case 'removerole': {
        const target = options.member;
        const role = options.role;
        if (!target || !role) { await reply('User and role required'); break; }
        if (!canManageRole(member, role)) { await reply('Cannot manage that role'); break; }
        await target.roles.remove(role);
        await reply(`Removed ${role.name} from ${target.user.tag}`);
        break;
      }
      case 'nickname': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        if (!canModerate(member, target)) { await reply('Cannot moderate'); break; }
        await target.setNickname(options.nick || null);
        await reply(`Nickname updated`);
        break;
      }
      case 'ticket': {
        const type = options.type || 'support';
        const res = await createTicket(guild, user, type, member);
        if (res.ok) await reply(`Ticket: <#${res.channel.id}>`);
        else await reply(res.msg);
        break;
      }
      case 'close': {
        const ticket = Object.entries(gc.tickets.open || {}).find(([, t]) => t.channelId === channel.id && !t.closed);
        if (!ticket) { await reply('Not a ticket channel'); break; }
        const confirmId = `tclose_${ticket[0]}_${Date.now()}`;
        pendingCloseConfirmations.set(confirmId, { ticketId: ticket[0], reason: options.reason || '', closerId: user.id, expires: Date.now() + 30000 });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`confirm_${confirmId}`).setLabel('Confirm').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`cancel_${confirmId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );
        if (isSlash) await interaction.editReply({ content: 'Confirm close?', components: [row] });
        else await channel.send({ content: 'Confirm close?', components: [row] });
        break;
      }
      case 'claim': {
        const ticket = Object.entries(gc.tickets.open || {}).find(([, t]) => t.channelId === channel.id && !t.closed);
        if (!ticket) { await reply('Not a ticket'); break; }
        ticket[1].claimedBy = user.id;
        saveConfig();
        await reply(`Claimed by ${user.tag}`);
        break;
      }
      case 'unclaim': {
        const ticket = Object.entries(gc.tickets.open || {}).find(([, t]) => t.channelId === channel.id && !t.closed);
        if (!ticket) { await reply('Not a ticket'); break; }
        const t = ticket[1];
        const isMgmt = expandTiers(getMemberTiers(member)).has('management');
        if (t.claimedBy && t.claimedBy !== user.id && !isMgmt) { await reply('Only claimer or management can unclaim'); break; }
        t.claimedBy = null;
        saveConfig();
        await reply('Unclaimed');
        break;
      }
      case 'tadd': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        await channel.permissionOverwrites.edit(target.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
        await reply(`Added ${target.user.tag}`);
        break;
      }
      case 'tremove': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        await channel.permissionOverwrites.delete(target.id);
        await reply(`Removed ${target.user.tag}`);
        break;
      }
      case 'accept': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        await doAccept(member, target, options.rank, options.notes);
        await reply(`Accepted ${target.user.tag}`);
        break;
      }
      case 'deny': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        await doDeny(member, target, options.reason);
        await reply(`Denied ${target.user.tag}`);
        break;
      }
      case 'promote': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        const res = await doPromote(member, target, options.rank, options.notes, options.role);
        await reply(res.ok ? `Promoted ${target.user.tag}` : res.msg);
        break;
      }
      case 'demote': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        const res = await doDemote(member, target, options.rank, options.reason, options.role);
        await reply(res.ok ? `Demoted ${target.user.tag}` : res.msg);
        break;
      }
      case 'infract': {
        const target = options.member;
        if (!target) { await reply('User required'); break; }
        await doInfract(member, target, options.type, options.reason);
        await reply(`Infraction issued to ${target.user.tag}`);
        break;
      }
      case 'acceptsetup': {
        const ids = (options.roles || '').split(/\s+/).filter(Boolean);
        gc.acceptRoleIds = ids;
        gc.roles.accept = ids;
        saveConfig();
        await reply(`Accept roles set: ${ids.length}`);
        break;
      }
      case 'antinuke': {
        const embed = new EmbedBuilder()
          .setTitle('Anti-nuke')
          .setDescription([
            `Enabled: ${gc.antinuke.enabled}`,
            `Threshold: ${gc.antinuke.threshold} / ${gc.antinuke.windowMs}ms`,
            `Whitelist: ${gc.antinuke.whitelist.length}`,
            `Watchlist: ${Object.keys(gc.antinuke.watchlist || {}).length}`
          ].join('\n'))
          .setColor(0xFF0000);
        await reply(null, [embed]);
        break;
      }
      case 'setup': {
        if (isSlash) await interaction.editReply({ embeds: [setupMainEmbed(guild)], components: setupMainRows() });
        else await channel.send({ embeds: [setupMainEmbed(guild)], components: setupMainRows() });
        break;
      }
      case 'poll': {
        const question = options.question;
        const optStr = options.options || '';
        const opts = optStr.split('|').map(s => s.trim()).filter(Boolean).slice(0, 10);
        if (!question || opts.length < 2) { await reply('Need question and 2–10 options separated by |'); break; }
        const votes = {};
        opts.forEach((_, i) => { votes[i] = []; });
        const embed = new EmbedBuilder().setTitle(question)
          .setDescription(opts.map((o, i) => `**${i + 1}.** ${o} — 0`).join('\n'))
          .setFooter({ text: 'Total votes: 0' }).setColor(0x5865F2);
        const rows = [];
        for (let i = 0; i < opts.length; i += 5) {
          rows.push(new ActionRowBuilder().addComponents(
            ...opts.slice(i, i + 5).map((o, j) =>
              new ButtonBuilder().setCustomId(`poll_vote_${i + j}`).setLabel(`${i + j + 1}`).setStyle(ButtonStyle.Secondary)
            )
          ));
        }
        let actualMsg;
        if (isSlash) {
          await interaction.editReply({ embeds: [embed], components: rows });
          actualMsg = await interaction.fetchReply();
        } else {
          actualMsg = await channel.send({ embeds: [embed], components: rows });
        }
        pollStore.set(actualMsg.id, {
          question, options: opts, votes, guildId: guild.id, channelId: channel.id,
          endsAt: options.duration ? Date.now() + options.duration * 60000 : null
        });
        if (options.duration) {
          setTimeout(async () => {
            const p = pollStore.get(actualMsg.id);
            if (!p) return;
            const total = Object.values(p.votes).reduce((a, v) => a + v.length, 0);
            const desc = p.options.map((o, i) => `**${i + 1}.** ${o} — ${p.votes[i]?.length || 0}`).join('\n');
            const endEmbed = new EmbedBuilder().setTitle(p.question + ' (ended)').setDescription(desc).setFooter({ text: `Total votes: ${total}` }).setColor(0x990000);
            const ch = guild.channels.cache.get(p.channelId);
            if (ch) {
              const m = await ch.messages.fetch(actualMsg.id).catch(() => null);
              if (m) await m.edit({ embeds: [endEmbed], components: [] }).catch(() => {});
            }
            pollStore.delete(actualMsg.id);
          }, options.duration * 60000);
        }
        break;
      }
      case 'giveaway': {
        const prize = options.prize;
        const duration = options.duration || 60;
        const winners = options.winners || 1;
        const targetCh = options.channel || channel;
        if (!prize) { await reply('Prize required'); break; }
        const embed = new EmbedBuilder().setTitle('Giveaway')
          .setDescription(`Prize: **${prize}**\nWinners: ${winners}\nEnds: <t:${Math.floor((Date.now() + duration * 60000) / 1000)}:R>\nEntries: 0`)
          .setColor(0xFEE75C);
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('giveaway_join').setLabel('Join').setStyle(ButtonStyle.Success)
        );
        const msg = await targetCh.send({ embeds: [embed], components: [row] });
        giveawayStore.set(`${guild.id}:${msg.id}`, {
          prize, winners, entries: [], channelId: targetCh.id, messageId: msg.id,
          guildId: guild.id, endsAt: Date.now() + duration * 60000,
          requiredRole: options.role?.id || null, ended: false
        });
        setTimeout(() => endGiveaway(guild, msg.id), duration * 60000);
        await reply(`Giveaway started in <#${targetCh.id}>`);
        break;
      }
      case 'giveaway-end': {
        if (!options.messageid) { await reply('Message ID required'); break; }
        await endGiveaway(guild, options.messageid);
        await reply('Giveaway ended');
        break;
      }
      case 'giveaway-reroll': {
        const mid = options.messageid;
        if (!mid) { await reply('Message ID required'); break; }
        const key = `${guild.id}:${mid}`;
        const g = giveawayStore.get(key) || endedGiveawayStore.get(key);
        if (!g) { await reply('Giveaway data not in memory — cannot reroll'); break; }
        const pool = [...(g.entries || [])];
        if (!pool.length) { await reply('No entries'); break; }
        const winner = pool[Math.floor(Math.random() * pool.length)];
        await channel.send(`Winner: <@${winner}> — ${g.prize}`);
        await reply('Rerolled');
        break;
      }
      case 'suggest': {
        if (!gc.channels.suggestions) { await reply('Suggestions channel not set'); break; }
        const ch = guild.channels.cache.get(gc.channels.suggestions);
        if (!ch) { await reply('Suggestions channel missing'); break; }
        const text = options.text;
        if (!text) { await reply('Text required'); break; }
        const embed = new EmbedBuilder().setTitle('Suggestion').setDescription(text)
          .setFooter({ text: `By ${user.tag}` }).setColor(0x5865F2).setTimestamp();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('sug_up').setLabel('0').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('sug_down').setLabel('0').setStyle(ButtonStyle.Danger)
        );
        const msg = await ch.send({ embeds: [embed], components: [row] });
        gc.suggestions[msg.id] = { up: [], down: [], authorId: user.id, text, status: 'open' };
        saveConfig();
        await reply('Suggestion posted');
        break;
      }
      case 'feedback': {
        if (!gc.channels.staffFeedback) { await reply('Staff feedback channel not set'); break; }
        const ch = guild.channels.cache.get(gc.channels.staffFeedback);
        if (!ch) { await reply('Channel missing'); break; }
        const text = options.text;
        if (!text) { await reply('Text required'); break; }
        const embed = new EmbedBuilder().setTitle('Staff feedback').setDescription(text)
          .setFooter({ text: `By ${user.tag}` }).setColor(0xEB459E).setTimestamp();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('fb_up').setLabel('0').setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('fb_down').setLabel('0').setStyle(ButtonStyle.Danger)
        );
        const msg = await ch.send({ embeds: [embed], components: [row] });
        if (!gc.feedback) gc.feedback = {};
        gc.feedback[msg.id] = { up: [], down: [], authorId: user.id, text };
        saveConfig();
        await reply('Feedback submitted');
        break;
      }
      case 'suggestion-approve':
      case 'suggestion-deny': {
        const mid = options.messageid;
        if (!mid || !gc.suggestions[mid]) { await reply('Suggestion not found'); break; }
        const status = commandName === 'suggestion-approve' ? 'approved' : 'denied';
        gc.suggestions[mid].status = status;
        saveConfig();
        const ch = guild.channels.cache.get(gc.channels.suggestions);
        if (ch) {
          const msg = await ch.messages.fetch(mid).catch(() => null);
          if (msg) {
            const emb = msg.embeds[0];
            const newEmb = EmbedBuilder.from(emb).setColor(status === 'approved' ? 0x57F287 : 0xED4245).setTitle(`Suggestion (${status})`);
            await msg.edit({ embeds: [newEmb] }).catch(() => {});
          }
        }
        await reply(`Suggestion ${status}`);
        break;
      }
      default:
        await reply('Unknown command');
    }
  } catch (e) {
    console.error(`[cmd] ${commandName}:`, e);
    try { await reply(`Error: ${e.message}`); } catch {}
  }
}

// ============================================================================
// CLIENT READY
// ============================================================================

async function onClientReady() {
  console.log(`Logged in as ${client.user.tag}`);
  const hasMC = client.options.intents.has(GatewayIntentBits.MessageContent);
  if (!hasMC) {
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
    console.error('MessageContent intent is DISABLED.');
    console.error('Prefix commands and automod will not work.');
    console.error('Enable it in the Discord Developer Portal.');
    console.error('!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!');
  }
  loadConfig();
  for (const [, guild] of client.guilds.cache) {
    getGuildConfig(guild.id);
    await registerCommands(guild);
  }

  setInterval(() => {
    const now = Date.now();
    for (const [mid, data] of ghostPingTracker) {
      if (data.expires < now) ghostPingTracker.delete(mid);
    }
    for (const [id, data] of pendingCloseConfirmations) {
      if (data.expires < now) pendingCloseConfirmations.delete(id);
    }
    for (const [uid, data] of pendingSetupChannel) {
      if (data.expires < now) pendingSetupChannel.delete(uid);
    }
    for (const [uid, data] of pendingSetupRoles) {
      if (data.expires < now) pendingSetupRoles.delete(uid);
    }
    for (const [uid, data] of pendingSetupTicketType) {
      if (data.expires < now) pendingSetupTicketType.delete(uid);
    }
    for (const gid of Object.keys(config.guilds || {})) {
      const gc = config.guilds[gid];
      if (!gc?.tickets?.open) continue;
      for (const [tid, t] of Object.entries(gc.tickets.open)) {
        if (t.closed && t.closedAt && now - t.closedAt > 7 * 24 * 60 * 60 * 1000) delete gc.tickets.open[tid];
      }
      if (gc.antinuke?.watchlist) {
        for (const [uid, exp] of Object.entries(gc.antinuke.watchlist)) {
          if (exp < now) delete gc.antinuke.watchlist[uid];
        }
      }
    }
    saveConfig();
  }, 60000);
}

let _readyRan = false;
const _runReadyOnce = async () => {
  if (_readyRan) return;
  _readyRan = true;
  await onClientReady();
};
client.once('clientReady', _runReadyOnce);
client.once('ready', _runReadyOnce);

client.on('guildCreate', async (guild) => {
  getGuildConfig(guild.id);
  await registerCommands(guild);
});

// ============================================================================
// INTERACTION HANDLER
// ============================================================================

client.on('interactionCreate', async (interaction) => {
  try {
    // ---- Slash commands ----
    if (interaction.isChatInputCommand()) {
      const guild = interaction.guild;
      if (!guild) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral }).catch(() => interaction.deferReply().catch(() => {}));
      let member = interaction.member;
      if (!member || !member.roles) member = await guild.members.fetch(interaction.user.id).catch(() => null);
      if (!member) { await interaction.editReply({ content: 'Member fetch failed' }); return; }

      const gc = getGuildConfig(guild.id);
      const commandName = interaction.commandName;

      if (gc.customCommands?.[commandName]) {
        await handleCommand({
          guild, member, user: interaction.user, channel: interaction.channel,
          commandName, options: {}, isSlash: true, interaction
        });
        return;
      }

      const options = {};
      for (const opt of interaction.options.data) {
        if (opt.type === 6) {
          options.user = opt.user;
          options.member = opt.member || await guild.members.fetch(opt.user.id).catch(() => null);
        } else if (opt.type === 8) options.role = opt.role;
        else if (opt.type === 7) options.channel = opt.channel;
        else options[opt.name] = opt.value;
      }
      if (options.user && !options.member) options.member = await guild.members.fetch(options.user.id).catch(() => null);

      await handleCommand({
        guild, member, user: interaction.user, channel: interaction.channel,
        commandName, options, isSlash: true, interaction
      });
      return;
    }

    // ---- Select menus ----
    if (interaction.isStringSelectMenu() ||
        interaction.isChannelSelectMenu() ||
        interaction.isRoleSelectMenu() ||
        interaction.isUserSelectMenu()) {
      if (interaction.customId === 'ticket_type_select') {
        const type = interaction.values[0];
        await interaction.deferUpdate().catch(() => {});
        const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const res = await createTicket(interaction.guild, interaction.user, type, member);
        await interaction.editReply({
          content: res.ok ? `Ticket: <#${res.channel.id}>` : res.msg,
          components: []
        }).catch(async () => {
          await interaction.followUp({
            content: res.ok ? `Ticket: <#${res.channel.id}>` : res.msg,
            flags: MessageFlags.Ephemeral
          }).catch(() => {});
        });
        return;
      }
      if (interaction.customId.startsWith('setup_')) {
        if (!canRunCommand(interaction.member, 'setup')) {
          await interaction.reply({ content: 'No permission', flags: MessageFlags.Ephemeral });
          return;
        }
        await handleSetupSelect(interaction);
        return;
      }
    }

    // ---- Buttons ----
    if (interaction.isButton()) {
      const id = interaction.customId;

      if (id.startsWith('setup_')) {
        if (!canRunCommand(interaction.member, 'setup')) {
          await interaction.reply({ content: 'No permission', flags: MessageFlags.Ephemeral });
          return;
        }
        await handleSetupButton(interaction);
        return;
      }

      if (id === 'ticket_panel_open') {
        const gc = getGuildConfig(interaction.guild.id);
        const options = [];
        if (gc.tickets.supportCategory) {
          options.push(new StringSelectMenuOptionBuilder().setLabel('Support').setDescription('General support ticket').setValue('support'));
        }
        if (gc.tickets.highrankCategory) {
          options.push(new StringSelectMenuOptionBuilder().setLabel('Highrank').setDescription('High rank ticket').setValue('highrank'));
        }
        if (!options.length) {
          await interaction.reply({ content: 'Ticket categories are not configured.', flags: MessageFlags.Ephemeral });
          return;
        }
        if (options.length === 1) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
          const res = await createTicket(interaction.guild, interaction.user, options[0].data.value, member);
          await interaction.editReply({ content: res.ok ? `Ticket: <#${res.channel.id}>` : res.msg });
          return;
        }
        const select = new StringSelectMenuBuilder()
          .setCustomId('ticket_type_select')
          .setPlaceholder('Select a ticket type...')
          .addOptions(options);
        await interaction.reply({
          content: 'Select a ticket type:',
          components: [new ActionRowBuilder().addComponents(select)],
          flags: MessageFlags.Ephemeral
        });
        return;
      }

      if (id === 'ticket_panel_rules') {
        const gc = getGuildConfig(interaction.guild.id);
        const embed = new EmbedBuilder()
          .setTitle('Ticket Rules')
          .setDescription(gc.tickets.rules || 'No rules configured.')
          .setColor(0xE67E22);
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        return;
      }

      if (id === 'ticket_open_support' || id === 'ticket_open_highrank') {
        const type = id === 'ticket_open_highrank' ? 'highrank' : 'support';
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const member = interaction.member || await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        const res = await createTicket(interaction.guild, interaction.user, type, member);
        await interaction.editReply({ content: res.ok ? `Ticket: <#${res.channel.id}>` : res.msg });
        return;
      }

      if (id.startsWith('ticket_close_')) {
        const ticketId = id.slice('ticket_close_'.length);
        const confirmId = `tclose_${ticketId}_${Date.now()}`;
        pendingCloseConfirmations.set(confirmId, {
          ticketId, reason: '', closerId: interaction.user.id, expires: Date.now() + 30000
        });
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId(`confirm_${confirmId}`).setLabel('Confirm').setStyle(ButtonStyle.Danger),
          new ButtonBuilder().setCustomId(`cancel_${confirmId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary)
        );
        await interaction.reply({ content: 'Confirm close?', components: [row], flags: MessageFlags.Ephemeral });
        return;
      }

      if (id.startsWith('confirm_')) {
        const confirmId = id.slice('confirm_'.length);
        const pending = pendingCloseConfirmations.get(confirmId);
        if (!pending || pending.expires < Date.now()) {
          await interaction.reply({ content: 'Expired', flags: MessageFlags.Ephemeral });
          return;
        }
        pendingCloseConfirmations.delete(confirmId);
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const res = await closeTicket(interaction.guild, pending.ticketId, interaction.member, pending.reason);
        await interaction.editReply({ content: res.ok ? 'Closing' : res.msg });
        return;
      }

      if (id.startsWith('cancel_')) {
        const confirmId = id.slice('cancel_'.length);
        pendingCloseConfirmations.delete(confirmId);
        await interaction.update({ content: 'Cancelled', components: [] });
        return;
      }

      if (id.startsWith('ticket_claim_')) {
        const ticketId = id.slice('ticket_claim_'.length);
        const gc = getGuildConfig(interaction.guild.id);
        const ticket = gc.tickets.open[ticketId];
        if (!ticket || ticket.closed) {
          await interaction.reply({ content: 'Ticket not found', flags: MessageFlags.Ephemeral });
          return;
        }
        ticket.claimedBy = interaction.user.id;
        saveConfig();
        await interaction.reply({ content: `Claimed by ${interaction.user.tag}` });
        return;
      }

      if (id.startsWith('poll_vote_')) {
        const idx = parseInt(id.slice('poll_vote_'.length), 10);
        const poll = pollStore.get(interaction.message.id);
        if (!poll) { await interaction.reply({ content: 'Poll ended', flags: MessageFlags.Ephemeral }); return; }
        for (const k of Object.keys(poll.votes)) poll.votes[k] = poll.votes[k].filter(uid => uid !== interaction.user.id);
        if (!poll.votes[idx]) poll.votes[idx] = [];
        poll.votes[idx].push(interaction.user.id);
        const total = Object.values(poll.votes).reduce((a, v) => a + v.length, 0);
        const desc = poll.options.map((o, i) => `**${i + 1}.** ${o} — ${poll.votes[i]?.length || 0}`).join('\n');
        const embed = new EmbedBuilder().setTitle(poll.question).setDescription(desc).setFooter({ text: `Total votes: ${total}` }).setColor(0x5865F2);
        await interaction.update({ embeds: [embed] });
        return;
      }

      if (id === 'giveaway_join') {
        const key = `${interaction.guild.id}:${interaction.message.id}`;
        const g = giveawayStore.get(key);
        if (!g || g.ended) { await interaction.reply({ content: 'Giveaway ended', flags: MessageFlags.Ephemeral }); return; }
        if (g.requiredRole && !interaction.member.roles.cache.has(g.requiredRole)) {
          await interaction.reply({ content: 'Missing required role', flags: MessageFlags.Ephemeral });
          return;
        }
        if (g.entries.includes(interaction.user.id)) {
          await interaction.reply({ content: 'Already entered', flags: MessageFlags.Ephemeral });
          return;
        }
        g.entries.push(interaction.user.id);
        const embed = EmbedBuilder.from(interaction.message.embeds[0])
          .setDescription(`Prize: **${g.prize}**\nWinners: ${g.winners}\nEnds: <t:${Math.floor(g.endsAt / 1000)}:R>\nEntries: ${g.entries.length}`);
        await interaction.message.edit({ embeds: [embed] }).catch(() => {});
        await interaction.reply({ content: 'Entered', flags: MessageFlags.Ephemeral });
        return;
      }

      if (id === 'sug_up' || id === 'sug_down') {
        const gc = getGuildConfig(interaction.guild.id);
        const sug = gc.suggestions[interaction.message.id];
        if (!sug) { await interaction.reply({ content: 'Not found', flags: MessageFlags.Ephemeral }); return; }
        const uid = interaction.user.id;
        sug.up = sug.up.filter(x => x !== uid);
        sug.down = sug.down.filter(x => x !== uid);
        if (id === 'sug_up') sug.up.push(uid); else sug.down.push(uid);
        saveConfig();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('sug_up').setLabel(String(sug.up.length)).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('sug_down').setLabel(String(sug.down.length)).setStyle(ButtonStyle.Danger)
        );
        await interaction.update({ components: [row] });
        return;
      }

      if (id === 'fb_up' || id === 'fb_down') {
        const gc = getGuildConfig(interaction.guild.id);
        if (!gc.feedback) gc.feedback = {};
        let fb = gc.feedback[interaction.message.id];
        if (!fb) {
          fb = { up: [], down: [] };
          gc.feedback[interaction.message.id] = fb;
        }
        const uid = interaction.user.id;
        fb.up = fb.up.filter(x => x !== uid);
        fb.down = fb.down.filter(x => x !== uid);
        if (id === 'fb_up') fb.up.push(uid);
        else fb.down.push(uid);
        saveConfig();
        const row = new ActionRowBuilder().addComponents(
          new ButtonBuilder().setCustomId('fb_up').setLabel(String(fb.up.length)).setStyle(ButtonStyle.Success),
          new ButtonBuilder().setCustomId('fb_down').setLabel(String(fb.down.length)).setStyle(ButtonStyle.Danger)
        );
        await interaction.update({ components: [row] });
        return;
      }
    }

    // ---- Modals ----
    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
      return;
    }
  } catch (e) {
    console.error('[interaction]', e);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: `Error: ${e.message}` }).catch(() => {});
      } else {
        await interaction.reply({ content: `Error: ${e.message}`, flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    } catch {}
  }
});

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

client.on('messageCreate', async (message) => {
  if (!message.guild || message.author.bot) return;

  const deleted = await runAutomod(message, false);
  if (deleted) return;

  const gc = getGuildConfig(message.guild.id);
  const prefix = gc.prefix || '!';
  const content = message.content.trim();

  const botMention = new RegExp(`^<@!?${client.user.id}>\\s*help$`, 'i');
  if (botMention.test(content)) {
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!member) return;
    await handleCommand({
      guild: message.guild, member, user: message.author, channel: message.channel,
      commandName: 'help', options: {}, isSlash: false, message, args: []
    });
    return;
  }

  if (!content.toLowerCase().startsWith(prefix.toLowerCase())) return;

  const body = content.slice(prefix.length).trim();
  if (!body) return;
  const parts = body.split(/\s+/);
  const commandName = parts[0].toLowerCase();
  const args = parts.slice(1);

  const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
  if (!member) return;

  const options = {};
  const resolveUser = async (str) => {
    if (!str) return null;
    const m = str.match(/^<@!?(\d+)>$/) || str.match(/^(\d{17,20})$/);
    if (m) {
      const u = await client.users.fetch(m[1]).catch(() => null);
      const mem = await message.guild.members.fetch(m[1]).catch(() => null);
      return { user: u, member: mem };
    }
    return null;
  };
  const resolveRole = (str) => {
    if (!str) return null;
    const m = str.match(/^<@&(\d+)>$/) || str.match(/^(\d{17,20})$/);
    if (m) return message.guild.roles.cache.get(m[1]);
    return message.guild.roles.cache.find(r => r.name.toLowerCase() === str.toLowerCase()) || null;
  };

  if (['mute', 'unmute', 'warn', 'kick', 'ban', 'history', 'addrole', 'removerole', 'nickname', 'accept', 'deny', 'promote', 'demote', 'infract', 'tadd', 'tremove', 'avatar', 'whois', 'userinfo'].includes(commandName)) {
    const resolved = await resolveUser(args[0]);
    if (resolved) { options.user = resolved.user; options.member = resolved.member; }
  }

  if (commandName === 'mute') {
    options.duration = args[1];
    options.reason = args.slice(2).join(' ') || args.slice(1).join(' ');
  } else if (commandName === 'unmute' || commandName === 'warn' || commandName === 'kick') {
    options.reason = args.slice(1).join(' ');
  } else if (commandName === 'ban') {
    if (!options.member && args[0]) options.userid = args[0];
    options.reason = args.slice(1).join(' ');
  } else if (commandName === 'unban') {
    options.userid = args[0];
    options.reason = args.slice(1).join(' ');
  } else if (commandName === 'clear' || commandName === 'purge') {
    options.amount = args[0];
    if (args[1]) { const r = await resolveUser(args[1]); if (r) options.user = r.user; }
  } else if (commandName === 'loguser') {
    options.username = args[0];
    options.reason = args.slice(1).join(' ');
  } else if (commandName === 'robloxhistory') {
    options.username = args[0];
  } else if (commandName === 'addrole' || commandName === 'removerole') {
    options.role = resolveRole(args[1]);
  } else if (commandName === 'nickname') {
    options.nick = args.slice(1).join(' ');
  } else if (commandName === 'ticket') {
    options.type = args[0] || 'support';
  } else if (commandName === 'close') {
    options.reason = args.join(' ');
  } else if (commandName === 'accept') {
    options.rank = args[1];
    options.notes = args.slice(2).join(' ');
  } else if (commandName === 'deny') {
    options.reason = args.slice(1).join(' ');
  } else if (commandName === 'promote') {
    options.rank = args[1];
    options.role = resolveRole(args[1]) || resolveRole(args[2]);
    options.notes = args.slice(2).join(' ');
  } else if (commandName === 'demote') {
    options.rank = args[1];
    options.role = resolveRole(args[1]) || resolveRole(args[2]);
    options.reason = args.slice(2).join(' ');
  } else if (commandName === 'infract') {
    options.type = args[1];
    options.reason = args.slice(2).join(' ');
  } else if (commandName === 'acceptsetup') {
    options.roles = args.join(' ');
  } else if (commandName === 'poll') {
    const full = args.join(' ');
    const pipeIdx = full.indexOf('|');
    if (pipeIdx === -1) { options.question = args[0]; options.options = args.slice(1).join(' '); }
    else { options.question = full.slice(0, pipeIdx).trim(); options.options = full.slice(pipeIdx + 1).trim(); }
  } else if (commandName === 'giveaway') {
    if (args.length >= 2) {
      const last = args[args.length - 1];
      if (/^\d+$/.test(last)) { options.duration = parseInt(last, 10); options.prize = args.slice(0, -1).join(' '); }
      else { options.prize = args.join(' '); options.duration = 60; }
    } else { options.prize = args[0]; options.duration = 60; }
  } else if (['giveaway-end', 'giveaway-reroll', 'suggestion-approve', 'suggestion-deny'].includes(commandName)) {
    options.messageid = args[0];
  } else if (commandName === 'suggest' || commandName === 'feedback') {
    options.text = args.join(' ');
  }

  await handleCommand({
    guild: message.guild, member, user: message.author, channel: message.channel,
    commandName, options, isSlash: false, message, args
  });
});

// ============================================================================
// MESSAGE UPDATE
// ============================================================================

client.on('messageUpdate', async (oldMsg, newMsg) => {
  if (!newMsg.guild || newMsg.author?.bot) return;
  if (oldMsg.content === newMsg.content) return;
  if (newMsg.partial) { try { newMsg = await newMsg.fetch(); } catch { return; } }
  await runAutomod(newMsg, true);
});

// ============================================================================
// GHOST PING
// ============================================================================

client.on('messageDelete', async (message) => {
  if (!message.guild || !message.id) return;
  if (automodDeletedIds.has(message.id)) {
    automodDeletedIds.delete(message.id);
    ghostPingTracker.delete(message.id);
    return;
  }
  const tracked = ghostPingTracker.get(message.id);
  if (!tracked) return;
  ghostPingTracker.delete(message.id);
  if (tracked.authorId === client.user.id) return;

  const guild = message.guild;
  const gc = getGuildConfig(guild.id);
  if (!gc.automod.ghostPingEnabled) return;

  const embed = new EmbedBuilder().setTitle('Ghost ping')
    .setDescription(`Author: <@${tracked.authorId}>\nChannel: <#${tracked.channelId}>\nMentions: ${tracked.mentions.map(id => `<@${id}>`).join(', ')}\nContent: ${tracked.content?.slice(0, 300) || '—'}`)
    .setColor(0xFFAA00).setTimestamp();
  await broadcast(guild, embed, ['staff', 'log', 'webhook']);

  const ch = guild.channels.cache.get(tracked.channelId);
  if (ch) await ch.send(`<@${tracked.authorId}> — ghost ping detected.`).catch(() => {});
  addHistory(guild.id, tracked.authorId, {
    type: 'ghostping', moderator: 'automod', moderatorId: client.user.id,
    reason: 'Ghost ping', at: Date.now()
  });
});

// ============================================================================
// ANTINUKE EVENTS
// ============================================================================

client.on('channelDelete', async (channel) => {
  if (!channel.guild) return;
  const guild = channel.guild;
  const gc = getGuildConfig(guild.id);
  for (const [tid, t] of Object.entries(gc.tickets.open || {})) {
    if (t.channelId === channel.id && !t.closed) { t.closed = true; t.closedAt = Date.now(); saveConfig(); }
  }
  await processAuditAntinuke(guild, 'channelDelete', AuditLogEvent.ChannelDelete);
});

client.on('roleDelete', async (role) => {
  if (!role.guild) return;
  await processAuditAntinuke(role.guild, 'roleDelete', AuditLogEvent.RoleDelete);
});

client.on('guildBanAdd', async (ban) => {
  await processAuditAntinuke(ban.guild, 'guildBanAdd', AuditLogEvent.MemberBanAdd);
});

client.on('guildMemberRemove', async (member) => {
  await processAuditAntinuke(member.guild, 'guildMemberRemove', AuditLogEvent.MemberKick);
});

client.on('guildMemberAdd', async (member) => {
  const gc = getGuildConfig(member.guild.id);
  const exp = gc.antinuke.watchlist?.[member.id];
  if (exp && exp > Date.now()) {
    await stripAllRoles(member);
    if (member.moderatable) await member.timeout(24 * 60 * 60 * 1000, 'Anti-nuke watchlist').catch(() => {});
    const embed = new EmbedBuilder().setTitle('Watchlist rejoin')
      .setDescription(`${member.user.tag} (${member.id}) — roles stripped, 24h timeout`)
      .setColor(0xFF0000).setTimestamp();
    await broadcast(member.guild, embed, ['log', 'staff', 'webhook']);
  }
});

// ============================================================================
// SHUTDOWN & BOOT
// ============================================================================

process.on('SIGINT', () => { flushConfig(); process.exit(0); });
process.on('SIGTERM', () => { flushConfig(); process.exit(0); });

if (!process.env.TOKEN) {
  console.error('TOKEN missing in .env');
  process.exit(1);
}

loadConfig();
client.login(process.env.TOKEN);