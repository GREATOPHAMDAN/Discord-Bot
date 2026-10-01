// ==========================================
// EAGLE COUNTY ROLEPLAY BOT - V.3.3
// ==========================================

const {
    Client, GatewayIntentBits, Partials, EmbedBuilder,
    SlashCommandBuilder, PermissionFlagsBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelSelectMenuBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder,
    StringSelectMenuBuilder,
    WebhookClient, AttachmentBuilder, MessageFlags, version: djsVersion
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");

dotenv.config();
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error("ERROR: TOKEN missing from .env"); process.exit(1); }

const BOT_VERSION = "V.3.3";
const BOT_START_TIME = Date.now();

// ==========================================
// CONSTANTS
// ==========================================

const CONFIG_FILE = path.join(__dirname, "config.json");
const CONFIG_BAK = CONFIG_FILE + ".bak";
const CONFIG_TMP = CONFIG_FILE + ".tmp";
const DEFAULT_PREFIX = "!";
const DAILY_LIMIT = 15;
const DAILY_BAN_LIMIT = 10;
const DAILY_KICK_LIMIT = 15;
const WEBHOOK_COLOR = 0x2563EB;
const EMBED_ACCENT  = 0xFF8C00;
const SWEAR_MUTE_MS = 60 * 60 * 1000;

const REJOIN_WATCH_MS = 24 * 60 * 60 * 1000;
const REJOIN_MUTE_MS  = 24 * 60 * 60 * 1000;

const GHOST_PING_TTL = 60 * 1000;
const GHOST_MAP_MAX = 500;

const TICKET_CLOSE_CONFIRM_MS = 30 * 1000;
const SNIPE_TTL = 5 * 60 * 1000;
const HISTORY_CAP = 200;
const VOTE_TTL = 7 * 24 * 60 * 60 * 1000;

const DEFAULT_ANTINUKE = {
    enabled: true, threshold: 5, windowMs: 60000,
    whitelist: [], counters: {}, watchlist: {}
};

const DEFAULT_EXTREME_SWEARS = [
    "n1gger", "n1gga", "nigger", "nigga", "n1gg3r",
    "f4ggot", "faggot", "f4g", "kys", "kill yourself",
    "r3tard", "retard", "retarded", "chink", "spic",
    "k1ll yourself", "tranny", "tr4nny"
];

const TIER_INCLUDES = {
    staff: ["staff"],
    admin: ["admin", "staff"],
    highrank: ["highrank", "admin", "staff"],
    management: ["management", "highrank", "admin", "staff"]
};

const DEFAULT_COMMAND_PERMS = {
    setup: ["management"], setprefix: ["management"], setuptickets: ["management"],
    "set-webhook": ["management"], "remove-webhook": ["management"], antinuke: ["management"],
    customcommand: ["management"],

    acceptsetup: ["highrank", "management"], accept: ["highrank", "management"],
    deny: ["highrank", "management"],
    promote: ["highrank", "management"], demote: ["highrank", "management"],
    infract: ["highrank", "management"],

    mute: ["staff", "admin", "highrank", "management"],
    unmute: ["staff", "admin", "highrank", "management"],
    warn: ["staff", "admin", "highrank", "management"],
    kick: ["staff", "admin", "highrank", "management"],
    ban: ["admin", "highrank", "management"],
    unban: ["admin", "highrank", "management"],

    loguser: ["staff", "admin", "highrank", "management"],

    poll: ["staff", "admin", "highrank", "management"],
    giveaway: ["highrank", "management"],
    "giveaway-end": ["highrank", "management"],
    "giveaway-reroll": ["highrank", "management"],

    roles: ["staff", "admin", "highrank", "management"],
    history: ["staff", "admin", "highrank", "management"],
    roleinfo: ["everyone"],
    userinfo: ["everyone"],
    banner: ["everyone"],
    membercount: ["everyone"],
    serverinfo: ["everyone"],
    botinfo: ["everyone"],
    ping: ["everyone"],
    uptime: ["everyone"],
    invite: ["everyone"],
    afk: ["everyone"],
    av: ["everyone"],

    slowmode: ["staff", "admin", "highrank", "management"],
    lock: ["staff", "admin", "highrank", "management"],
    unlock: ["staff", "admin", "highrank", "management"],
    purge: ["staff", "admin", "highrank", "management"],
    deafen: ["staff", "admin", "highrank", "management"],
    undeafen: ["staff", "admin", "highrank", "management"],
    moveall: ["staff", "admin", "highrank", "management"],
    announce: ["highrank", "management"],
    addrole: ["staff", "admin", "highrank", "management"],
    removerole: ["staff", "admin", "highrank", "management"],
    nickname: ["staff", "admin", "highrank", "management"],
    nick: ["everyone"],
    snipe: ["staff", "admin", "highrank", "management"],

    ticket: ["staff", "admin", "highrank", "management"],
    close: ["everyone"], closeticket: ["everyone"], ticketclose: ["everyone"],

    suggest: ["everyone"], "staff-feedback": ["everyone"], help: ["everyone"],
    stats: ["everyone"],

    "suggestion-approve": ["highrank", "management"],
    "suggestion-deny": ["highrank", "management"]
};

const URL_REGEX = /(https?:\/\/\S+)|(www\.\S+)|(discord\.gg\/\S+)/i;

const RESERVED_NAMES = new Set([
    ...Object.keys(DEFAULT_COMMAND_PERMS),
    "mc", "whois", "avatar", "clear", "tadd", "tremove", "stats"
]);

// ==========================================
// CLIENT
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration, GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildWebhooks, GatewayIntentBits.DirectMessages
    ],
    partials: [
        Partials.Message, Partials.Channel, Partials.GuildMember,
        Partials.User
    ],
    ws: { compress: false },
    allowedMentions: { parse: ["users", "roles"], repliedUser: false },
    rest: { timeout: 15000 }
});

// ==========================================
// STATE
// ==========================================

const polls = new Map();
const _recentPingedMessages = new Map();
const _swearRegexCache = new Map();
const _whClients = new Map();
const guildConfigCache = new Map();
const _prefixCache = new Map();
const _memberTierCache = new Map();
const _tierCacheTTL = 30_000;
const _pendingCloseConfirmations = new Map();
const _snipeCache = new Map();

// ==========================================
// CONFIG
// ==========================================

function createDefaultGuildConfig() {
    return {
        prefix: DEFAULT_PREFIX,
        logChannelId: null, transcriptChannelId: null,
        welcomeChannelId: null, suggestionChannelId: null, staffFeedbackChannelId: null,
        staffLogChannelId: null, hrLogChannelId: null, ticketLogChannelId: null,
        ticketSupportCategoryId: null, ticketSupportPingRoleId: null,
        ticketHighRankCategoryId: null, ticketHighRankPingRoleId: null,
        webhookUrl: null,
        staffRoles: [], adminRoles: [], highRankRoles: [], managementRoles: [],
        exemptRoles: [], acceptRoleIds: [], hrPingRoleId: null,
        commandPerms: {},
        dmTemplates: {
            accept: "Congratulations! Your application for **{server}** has been accepted.\n\nPlease review the server for next steps.",
            promote: "You have been **promoted** in **{server}**!\n\n**New Rank:** {rank}",
            demote: "You have been **demoted** in **{server}**.\n\n**New Rank:** {rank}",
            infract: "You have received an infraction in **{server}**.\n\n**Type:** {type}\n**Reason:** {reason}",
            deny: "Unfortunately, your application for **{server}** has been **denied**.\n\n**Reason:** {reason}\n\nYou may reapply in the future."
        },
        antinuke: JSON.parse(JSON.stringify(DEFAULT_ANTINUKE)),
        automod: {
            extremeSweatEnabled: true,
            extremeSweatList: [...DEFAULT_EXTREME_SWEARS],
            ghostPingEnabled: true,
            linkFilterEnabled: true,
            linkWhitelistChannelIds: [],
            ignoredChannelIds: []
        },
        tickets: {},
        ticketCounter: 0,
        suggestions: {}, staffFeedback: {}, limits: {},
        afk: {},
        giveaways: {},
        customCommands: {},
        history: {},
        robloxLogs: {}
    };
}

function deepMerge(target, defaults) {
    for (const k in defaults) {
        if (target[k] === undefined) {
            target[k] = defaults[k];
        } else if (
            target[k] !== null && typeof target[k] === "object" && !Array.isArray(target[k]) &&
            defaults[k] !== null && typeof defaults[k] === "object" && !Array.isArray(defaults[k])
        ) {
            deepMerge(target[k], defaults[k]);
        }
    }
    return target;
}

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            const nc = { guilds: {} };
            atomicWrite(CONFIG_FILE, JSON.stringify(nc, null, 4));
            return nc;
        }
        const raw = fs.readFileSync(CONFIG_FILE, "utf8");
        const data = JSON.parse(raw);
        if (!data.guilds) data.guilds = {};
        return data;
    } catch (e) {
        console.error("loadConfig failed, trying backup:", e.message);
        try {
            if (fs.existsSync(CONFIG_BAK)) {
                const raw = fs.readFileSync(CONFIG_BAK, "utf8");
                const data = JSON.parse(raw);
                if (!data.guilds) data.guilds = {};
                console.log("Recovered from backup.");
                return data;
            }
        } catch (e2) { console.error("backup also failed:", e2.message); }
        return { guilds: {} };
    }
}

function atomicWrite(file, data) {
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, data);
    if (fs.existsSync(file)) {
        try { fs.copyFileSync(file, file + ".bak"); } catch {}
    }
    fs.renameSync(tmp, file);
}

let config = loadConfig();

let saveTimer = null, saveDirty = false;
function saveConfig() {
    saveDirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        if (!saveDirty) return;
        saveDirty = false;
        try { atomicWrite(CONFIG_FILE, JSON.stringify(config, null, 4)); }
        catch (e) { console.error("saveConfig:", e); }
    }, 250);
}
function flushSave() {
    if (!saveDirty) return;
    try { atomicWrite(CONFIG_FILE, JSON.stringify(config, null, 4)); }
    catch (e) { console.error("flushSave:", e); }
    saveDirty = false;
}

function getGuildConfig(guildId) {
    let gc = guildConfigCache.get(guildId);
    if (gc) return gc;

    if (!config.guilds[guildId]) {
        config.guilds[guildId] = createDefaultGuildConfig();
        saveConfig();
    }
    gc = config.guilds[guildId];

    const defaults = createDefaultGuildConfig();
    deepMerge(gc, defaults);

    // Ensure arrays
    for (const key of ["staffRoles", "adminRoles", "highRankRoles", "managementRoles", "exemptRoles", "acceptRoleIds"]) {
        if (!Array.isArray(gc[key])) gc[key] = [];
    }
    if (!gc.commandPerms || typeof gc.commandPerms !== "object") gc.commandPerms = {};
    if (!gc.antinuke.counters) gc.antinuke.counters = {};
    if (!Array.isArray(gc.antinuke.whitelist)) gc.antinuke.whitelist = [];
    if (!gc.antinuke.watchlist) gc.antinuke.watchlist = {};
    if (!gc.afk) gc.afk = {};
    if (!gc.giveaways) gc.giveaways = {};
    if (!Array.isArray(gc.automod.extremeSweatList)) gc.automod.extremeSweatList = [...DEFAULT_EXTREME_SWEARS];
    if (!Array.isArray(gc.automod.linkWhitelistChannelIds)) gc.automod.linkWhitelistChannelIds = [];
    if (!Array.isArray(gc.automod.ignoredChannelIds)) gc.automod.ignoredChannelIds = [];
    if (!gc.tickets) gc.tickets = {};
    if (!gc.customCommands) gc.customCommands = {};
    if (!gc.history) gc.history = {};
    if (!gc.robloxLogs) gc.robloxLogs = {};
    if (!gc.limits) gc.limits = {};
    if (!gc.suggestions) gc.suggestions = {};
    if (!gc.staffFeedback) gc.staffFeedback = {};

    guildConfigCache.set(guildId, gc);
    _prefixCache.set(guildId, gc.prefix || DEFAULT_PREFIX);
    return gc;
}

// ==========================================
// AUTOMOD
// ==========================================

function getSwearRegex(guildId) {
    const gc = getGuildConfig(guildId);
    const list = gc.automod.extremeSweatList || [];
    const hash = list.length + ":" + list.join("|");
    const cached = _swearRegexCache.get(guildId);
    if (cached && cached.listHash === hash) return cached.regex;

    const sorted = [...list].sort((a, b) => b.length - a.length);
    const escaped = sorted.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    let pattern = null;
    if (escaped.length) {
        try { pattern = new RegExp("\\b(" + escaped.join("|") + ")\\b", "gi"); }
        catch (e) { console.error("swear regex:", e); pattern = null; }
    }
    _swearRegexCache.set(guildId, { listHash: hash, regex: pattern });
    return pattern;
}

function invalidateSwearRegex(guildId) { _swearRegexCache.delete(guildId); }

const containsLink = content => !!content && URL_REGEX.test(content);

// ==========================================
// PERMISSIONS
// ==========================================

function getRequiredTiers(guildId, commandName) {
    const gc = getGuildConfig(guildId);
    const override = gc.commandPerms[commandName];
    if (override && Array.isArray(override) && override.length > 0) return override;
    return DEFAULT_COMMAND_PERMS[commandName] || ["management"];
}

function getMemberTiers(member) {
    if (!member) return new Set();
    const key = member.guild.id + ":" + member.id;
    const cached = _memberTierCache.get(key);
    const now = Date.now();
    if (cached && now - cached.at < _tierCacheTTL) return cached.tiers;

    const gc = getGuildConfig(member.guild.id);
    const tiers = new Set();

    // Owner + administrators get all tiers
    if (member.id === member.guild.ownerId) {
        tiers.add("management"); tiers.add("highrank"); tiers.add("admin"); tiers.add("staff");
    } else if (member.permissions.has(PermissionFlagsBits.Administrator)) {
        tiers.add("management"); tiers.add("highrank"); tiers.add("admin"); tiers.add("staff");
    }

    const roles = member.roles.cache;
    if (gc.staffRoles.length      && roles.some(r => gc.staffRoles.includes(r.id)))      tiers.add("staff");
    if (gc.adminRoles.length      && roles.some(r => gc.adminRoles.includes(r.id)))      tiers.add("admin");
    if (gc.highRankRoles.length   && roles.some(r => gc.highRankRoles.includes(r.id)))   tiers.add("highrank");
    if (gc.managementRoles.length && roles.some(r => gc.managementRoles.includes(r.id))) tiers.add("management");

    _memberTierCache.set(key, { tiers, at: now });
    return tiers;
}

function canRunCommand(member, commandName) {
    if (!member) return false;
    const required = getRequiredTiers(member.guild.id, commandName);
    if (required.includes("everyone")) return true;
    if (required.length === 0) return false; // treat empty as denied
    const memberTiers = getMemberTiers(member);
    if (memberTiers.size === 0) return false;
    const expanded = new Set();
    for (const t of memberTiers) { const list = TIER_INCLUDES[t]; if (list) for (const x of list) expanded.add(x); else expanded.add(t); }
    for (const t of required) if (expanded.has(t)) return true;
    return false;
}

function invalidateTierCache(guildId) {
    for (const k of _memberTierCache.keys()) if (k.startsWith(guildId + ":")) _memberTierCache.delete(k);
}

// ==========================================
// HELPERS
// ==========================================

const today = () => new Date().toISOString().split("T")[0];

function getLimitData(guildId, userId) {
    const gc = getGuildConfig(guildId);
    const d = today();
    const l = gc.limits[userId];
    if (!l || l.date !== d) { gc.limits[userId] = { date: d, mutes: 0, kicks: 0, bans: 0 }; saveConfig(); }
    if (l.kicks === undefined) l.kicks = 0;
    if (l.bans === undefined) l.bans = 0;
    return gc.limits[userId];
}

function getPrefix(guildId) {
    let p = _prefixCache.get(guildId);
    if (p) return p;
    p = getGuildConfig(guildId).prefix || DEFAULT_PREFIX;
    _prefixCache.set(guildId, p);
    return p;
}

function setPrefix(guildId, prefix) {
    const gc = getGuildConfig(guildId);
    gc.prefix = prefix;
    _prefixCache.set(guildId, prefix);
    saveConfig();
}

function getOrdinalSuffix(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

const hasRole = (m, ids) => !!(m?.roles && ids?.length && m.roles.cache.some(r => ids.includes(r.id)));

function isExempt(member) {
    if (!member) return false;
    const list = getGuildConfig(member.guild.id).exemptRoles;
    return list.length > 0 && hasRole(member, list);
}

function canModerate(moderator, target) {
    if (!moderator || !target) return false;
    if (target.id === moderator.id) return false;
    if (target.id === moderator.guild.ownerId) return false;
    if (moderator.id === moderator.guild.ownerId) return true;
    const m = moderator.roles?.highest?.position ?? -1;
    const t = target.roles?.highest?.position   ?? -1;
    return t < m;
}

function canManageRole(member, role) {
    if (!member || !role) return false;
    if (member.id === member.guild.ownerId) return true;
    if (role.position >= member.roles.highest.position) return false;
    const me = member.guild.members.me;
    if (!me || role.position >= me.roles.highest.position) return false;
    return true;
}

function parseDuration(input) {
    if (!input) return null;
    const m = input.match(/^(\d+)(s|m|h|d)$/i);
    if (!m) return null;
    const amt = +m[1], u = m[2].toLowerCase();
    const ms = amt * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[u]);
    return ms > 2419200000 ? null : ms;
}

const TEMPLATE_RE = /\{(\w+)\}/g;
const templateReplace = (tpl, vars) => tpl.replace(TEMPLATE_RE, (_, k) => (vars[k] ?? ""));

function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h < 24) return h + "h" + (rm ? " " + rm + "m" : "");
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return d + "d" + (rh ? " " + rh + "h" : "");
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(2) + " KB";
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(2) + " MB";
    return (bytes / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function hexToInt(hex) {
    if (typeof hex !== "string") return null;
    const clean = hex.replace(/^#/, "").trim();
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null;
    return parseInt(clean, 16);
}

async function resolveMember(guild, input) {
    if (!input) return null;
    const mentionMatch = input.match(/^<@!?(\d+)>$/);
    if (mentionMatch) return guild.members.fetch(mentionMatch[1]).catch(() => null);
    if (/^\d{15,25}$/.test(input)) return guild.members.fetch(input).catch(() => null);
    const lower = input.toLowerCase().replace(/^@/, "");
    return guild.members.cache.find(m =>
        m.user.username.toLowerCase() === lower ||
        m.user.tag.toLowerCase() === lower ||
        m.displayName.toLowerCase() === lower
    ) || null;
}

async function resolveUser(clientRef, input) {
    if (!input) return null;
    const mentionMatch = input.match(/^<@!?(\d+)>$/);
    if (mentionMatch) return clientRef.users.fetch(mentionMatch[1]).catch(() => null);
    if (/^\d{15,25}$/.test(input)) return clientRef.users.fetch(input).catch(() => null);
    return null;
}

function recordHistory(guildId, userId, entry) {
    const gc = getGuildConfig(guildId);
    if (!gc.history[userId]) gc.history[userId] = [];
    const arr = gc.history[userId];
    arr.unshift(entry);
    if (arr.length > HISTORY_CAP) arr.length = HISTORY_CAP;
    saveConfig();
}

// ==========================================
// EMBEDS
// ==========================================

const logEmbed     = (title, description, color = 0x808080) => new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
const errorEmbed   = d => new EmbedBuilder().setTitle("Error").setDescription(d).setColor(0xED4245).setTimestamp();
const successEmbed = d => new EmbedBuilder().setTitle("Success").setDescription(d).setColor(0x57F287).setTimestamp();
const infoEmbed    = d => new EmbedBuilder().setDescription(d).setColor(WEBHOOK_COLOR).setTimestamp();

// ==========================================
// LOGGING
// ==========================================

async function sendToChannel(guild, channelId, payload) {
    if (!channelId) return;
    const ch = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!ch) return;
    try { await ch.send(payload); } catch {}
}

async function sendWebhook(guild, embed) {
    const url = getGuildConfig(guild.id).webhookUrl;
    if (!url) return;
    try {
        let wh = _whClients.get(url);
        if (!wh) { wh = new WebhookClient({ url }); _whClients.set(url, wh); }
        const finalEmbed = EmbedBuilder.from(embed);
        if (guild.iconURL()) finalEmbed.setThumbnail(guild.iconURL({ size: 256 }));
        finalEmbed.setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined });
        await wh.send({ username: guild.name, avatarURL: guild.iconURL() || undefined, embeds: [finalEmbed] });
    } catch {}
}

function broadcast(guild, embed, targets) {
    const gc = getGuildConfig(guild.id);
    const promises = [];
    for (const t of targets) {
        if (t === "log")     promises.push(sendToChannel(guild, gc.logChannelId, { embeds: [embed] }));
        if (t === "staff")   promises.push(sendToChannel(guild, gc.staffLogChannelId, { embeds: [embed] }));
        if (t === "hr")      promises.push(sendToChannel(guild, gc.hrLogChannelId, { embeds: [embed] }));
        if (t === "ticket")  promises.push(sendToChannel(guild, gc.ticketLogChannelId, { embeds: [embed] }));
        if (t === "webhook") promises.push(sendWebhook(guild, embed));
    }
    return Promise.all(promises);
}

async function sendTranscript(guild, attachment, embed) {
    const gc = getGuildConfig(guild.id);
    if (!gc.transcriptChannelId) return;
    const ch = guild.channels.cache.get(gc.transcriptChannelId) || await guild.channels.fetch(gc.transcriptChannelId).catch(() => null);
    if (!ch) return;
    try { await ch.send({ embeds: [embed], files: [attachment] }); } catch {}
}

// ==========================================
// ANTI-NUKE
// ==========================================

async function fetchAuditExecutor(guild, eventType, targetId, withinMs = 15000) {
    try {
        const logs = await guild.fetchAuditLogs({ type: eventType, limit: 5 });
        const now = Date.now();
        const e = logs.entries.find(en => now - en.createdTimestamp < withinMs && (!targetId || en.target?.id === targetId));
        return e?.executor || null;
    } catch { return null; }
}

function recordAntinukeEvent(guildId, userId) {
    const gc = getGuildConfig(guildId);
    const now = Date.now();
    const win = gc.antinuke.windowMs || 60000;
    if (!gc.antinuke.counters[userId]) gc.antinuke.counters[userId] = [];
    gc.antinuke.counters[userId] = gc.antinuke.counters[userId].filter(t => now - t < win);
    gc.antinuke.counters[userId].push(now);
    saveConfig();
    return gc.antinuke.counters[userId].length;
}

async function stripAllRoles(member, reason) {
    if (!member) return { removed: 0, failed: 0 };
    const me = member.guild.members.me;
    const myPos = me.roles.highest.position;
    const all = member.roles.cache.filter(r => r.id !== member.guild.id);
    const removable = [...all.values()].filter(r => r.position < myPos && !r.managed);
    const failed = all.size - removable.length;
    let removed = 0;
    await Promise.all(removable.map(r => member.roles.remove(r, reason).then(() => removed++).catch(() => {})));
    return { removed, failed };
}

async function triggerAntinuke(guild, member, trigger, count) {
    const gc = getGuildConfig(guild.id);
    const { removed, failed } = await stripAllRoles(member, "Anti-Nuke: " + trigger);
    let kicked = false;
    try { await member.kick("Anti-Nuke: " + trigger); kicked = true; } catch {}

    const expiry = Date.now() + REJOIN_WATCH_MS;
    gc.antinuke.watchlist[member.id] = expiry;
    gc.antinuke.counters[member.id] = [];
    saveConfig();

    const embed = new EmbedBuilder().setTitle("🚨 ANTI-NUKE TRIGGERED")
        .setDescription(
            "**User:** " + member.user.tag + " (`" + member.id + "`)\n" +
            "**Trigger:** " + trigger + "\n**Count:** " + count + "\n" +
            "**Roles Removed:** " + removed + (failed ? " (failed: " + failed + ")" : "") + "\n" +
            "**Kicked:** " + (kicked ? "Yes" : "No") + "\n" +
            "**Watch Expires:** <t:" + ((expiry / 1000) | 0) + ":R>"
        )
        .setColor(0xED4245).setThumbnail(member.user.displayAvatarURL()).setTimestamp();

    const proms = [broadcast(guild, embed, ["log", "webhook"])];
    proms.push(member.send({ embeds: [new EmbedBuilder().setTitle("⚠️ Anti-Nuke Triggered")
        .setDescription("You triggered anti-nuke in **" + guild.name + "**.\n**Trigger:** " + trigger + "\n**Count:** " + count + "\n\nAll roles removed + kicked.\n**Rejoin within 24h = 24h mute.**")
        .setColor(0xED4245).setTimestamp()] }).catch(() => {}));
    proms.push(guild.fetchOwner().then(o => o.send({ embeds: [new EmbedBuilder().setTitle("🚨 Anti-Nuke Triggered in " + guild.name)
        .setDescription("**User:** " + member.user.tag + " (" + member.id + ")\n**Trigger:** " + trigger + "\n**Count:** " + count + "\n**Roles Removed:** " + removed + "\n**Kicked:** " + (kicked ? "Yes" : "No") + "\n\n**24h rejoin watch active.**")
        .setColor(0xED4245).setThumbnail(member.user.displayAvatarURL()).setTimestamp()] }).catch(() => {})).catch(() => {}));
    await Promise.all(proms);
}

async function handleAntinukeEvent(guild, userId, trigger) {
    const gc = getGuildConfig(guild.id);
    if (!gc.antinuke.enabled) return;
    if (gc.antinuke.whitelist.includes(userId)) return;
    if (userId === guild.ownerId || userId === client.user.id) return;
    const count = recordAntinukeEvent(guild.id, userId);
    if (count < gc.antinuke.threshold) return;
    const member = await guild.members.fetch(userId).catch(() => null);
    if (member) await triggerAntinuke(guild, member, trigger, count);
}

async function checkRejoinWatch(member) {
    const gc = getGuildConfig(member.guild.id);
    const expiry = gc.antinuke.watchlist[member.id];
    if (!expiry) return false;
    if (Date.now() > expiry) { delete gc.antinuke.watchlist[member.id]; saveConfig(); return false; }

    const { removed } = await stripAllRoles(member, "Anti-Nuke rejoin watch");
    let muted = false;
    try { await member.timeout(REJOIN_MUTE_MS, "Anti-Nuke: rejoined within 24h watch"); muted = true; } catch {}

    const embed = new EmbedBuilder().setTitle("🚨 Anti-Nuke Rejoin — Auto-Muted")
        .setDescription(
            "**User:** " + member.user.tag + " (`" + member.id + "`)\n" +
            "**Action:** Roles stripped + 24h timeout\n**Roles Removed:** " + removed + "\n" +
            "**Muted:** " + (muted ? "Yes" : "No") + "\n**Watch Expires:** <t:" + ((expiry / 1000) | 0) + ":R>"
        )
        .setColor(0xED4245).setThumbnail(member.user.displayAvatarURL()).setTimestamp();

    const proms = [broadcast(member.guild, embed, ["log", "webhook"])];
    proms.push(member.send({ embeds: [new EmbedBuilder().setTitle("🔇 Auto-Muted (Anti-Nuke)")
        .setDescription("You rejoined **" + member.guild.name + "** while on anti-nuke watch.\n\nMuted 24h + all roles removed.")
        .setColor(0xED4245).setTimestamp()] }).catch(() => {}));
    proms.push(member.guild.fetchOwner().then(o => o.send({ embeds: [new EmbedBuilder().setTitle("⚠️ Anti-Nuke Watch Triggered")
        .setDescription("**" + member.user.tag + "** rejoined during 24h watch.\n**Roles stripped + 24h mute applied.**\n**Watch expires <t:" + ((expiry / 1000) | 0) + ":R>**")
        .setColor(0xED4245).setThumbnail(member.user.displayAvatarURL()).setTimestamp()] }).catch(() => {})).catch(() => {}));
    await Promise.all(proms);
    return true;
}

// ==========================================
// AFK
// ==========================================

async function clearAfkIfSet(guild, member, sourceChannel) {
    const gc = getGuildConfig(guild.id);
    const data = gc.afk[member.id];
    if (!data) return false;

    delete gc.afk[member.id];
    saveConfig();

    if (sourceChannel) {
        const duration = formatDuration(Date.now() - data.since);
        sourceChannel.send({
            content: "👋 Welcome back " + member + "! You were AFK for **" + duration + "**.",
            allowedMentions: { users: [member.id] }
        }).catch(() => {});
    }
    return true;
}

async function notifyAfkMentions(message) {
    if (!message.mentions.members?.size) return;
    const gc = getGuildConfig(message.guild.id);
    const afkKeys = Object.keys(gc.afk);
    if (!afkKeys.length) return;

    const notices = [];
    for (const [id, member] of message.mentions.members) {
        const afk = gc.afk[id];
        if (!afk) continue;
        const duration = formatDuration(Date.now() - afk.since);
        notices.push("💤 **" + member.user.username + "** is AFK: " + afk.reason + " *(for " + duration + ")*");
    }
    if (!notices.length) return;

    const embed = new EmbedBuilder().setDescription(notices.join("\n")).setColor(0xFEE75C).setTimestamp();
    message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
}

// ==========================================
// CUSTOM COMMAND DISPATCH
// ==========================================

async function runCustomCommand(guild, name, ctx, isSlash) {
    const gc = getGuildConfig(guild.id);
    const cc = gc.customCommands[name];
    if (!cc || cc.enabled === false) return false;

    const payload = cc.type === "embed"
        ? { embeds: [new EmbedBuilder().setDescription(cc.response).setColor(cc.color || WEBHOOK_COLOR).setTimestamp()] }
        : { content: cc.response };

    try {
        if (isSlash) await ctx.reply(payload);
        else {
            if (cc.deleteTrigger) ctx.delete().catch(() => {});
            await ctx.reply(payload);
        }
    } catch (e) { console.error("custom cmd run:", e); }
    return true;
}

// ==========================================
// SLASH COMMANDS
// ==========================================

function getSlashCommands() {
    const cmds = [
        new SlashCommandBuilder().setName("setup").setDescription("Open the interactive setup menu"),
        new SlashCommandBuilder().setName("help").setDescription("Show bot commands"),
        new SlashCommandBuilder().setName("setprefix").setDescription("Set the server prefix")
            .addStringOption(o => o.setName("prefix").setDescription("New prefix").setRequired(true).setMaxLength(5)),
        new SlashCommandBuilder().setName("setuptickets").setDescription("Post the ticket panel"),

        new SlashCommandBuilder().setName("set-webhook").setDescription("Set the log webhook URL")
            .addStringOption(o => o.setName("url").setDescription("Discord webhook URL").setRequired(true)),
        new SlashCommandBuilder().setName("remove-webhook").setDescription("Remove the log webhook"),

        new SlashCommandBuilder().setName("acceptsetup").setDescription("Manage accept roles")
            .addSubcommand(s => s.setName("add").setDescription("Add an accept role")
                .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)))
            .addSubcommand(s => s.setName("remove").setDescription("Remove an accept role")
                .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)))
            .addSubcommand(s => s.setName("list").setDescription("List accept roles"))
            .addSubcommand(s => s.setName("clear").setDescription("Clear all accept roles")),

        new SlashCommandBuilder().setName("accept").setDescription("Accept a user's application")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Notes").setRequired(false)),
        new SlashCommandBuilder().setName("deny").setDescription("Deny a user's application")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason for denial").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Internal notes").setRequired(false)),

        new SlashCommandBuilder().setName("promote").setDescription("Promote a user")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addStringOption(o => o.setName("rank").setDescription("New rank").setRequired(true))
            .addRoleOption(o => o.setName("role").setDescription("Role to give (optional)").setRequired(false))
            .addStringOption(o => o.setName("notes").setDescription("Notes").setRequired(false)),
        new SlashCommandBuilder().setName("demote").setDescription("Demote a user")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addStringOption(o => o.setName("rank").setDescription("New rank").setRequired(true))
            .addRoleOption(o => o.setName("role").setDescription("Role to remove (optional)").setRequired(false))
            .addStringOption(o => o.setName("notes").setDescription("Notes").setRequired(false)),
        new SlashCommandBuilder().setName("infract").setDescription("Infract a user")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addStringOption(o => o.setName("type").setDescription("Type").setRequired(true)
                .addChoices(
                    { name: "Warn", value: "warn" },
                    { name: "Strike", value: "strike" },
                    { name: "Demotion", value: "demotion" },
                    { name: "Suspension", value: "suspension" }
                ))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Notes").setRequired(false)),

        new SlashCommandBuilder().setName("suggest").setDescription("Submit a suggestion")
            .addStringOption(o => o.setName("suggestion").setDescription("Suggestion").setRequired(true)),
        new SlashCommandBuilder().setName("staff-feedback").setDescription("Submit staff feedback")
            .addUserOption(o => o.setName("staff").setDescription("Staff member").setRequired(true))
            .addStringOption(o => o.setName("feedback").setDescription("Feedback").setRequired(true)),

        new SlashCommandBuilder().setName("mute").setDescription("Timeout a member")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addStringOption(o => o.setName("duration").setDescription("Example: 10m, 1h, 1d").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("unmute").setDescription("Remove a timeout")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("warn").setDescription("Warn a member")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("kick").setDescription("Kick a member")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("ban").setDescription("Ban a member")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(false))
            .addStringOption(o => o.setName("userid").setDescription("User ID (for hackban)").setRequired(false))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("unban").setDescription("Unban a user")
            .addStringOption(o => o.setName("userid").setDescription("Discord User ID").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

        new SlashCommandBuilder().setName("loguser").setDescription("Log a punishment for a Roblox user")
            .addStringOption(o => o.setName("username").setDescription("Roblox username").setRequired(true))
            .addStringOption(o => o.setName("punishment").setDescription("Punishment type").setRequired(true)
                .addChoices(
                    { name: "Warn", value: "warn" },
                    { name: "Kick", value: "kick" },
                    { name: "Ban", value: "ban" }
                ))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Additional notes (optional)").setRequired(false)),
        new SlashCommandBuilder().setName("robloxhistory").setDescription("Look up Roblox punishment history")
            .addStringOption(o => o.setName("username").setDescription("Roblox username").setRequired(true)),

        new SlashCommandBuilder().setName("poll").setDescription("Create a poll (up to 10 options)")
            .addStringOption(o => o.setName("question").setDescription("Poll question").setRequired(true).setMaxLength(250))
            .addStringOption(o => o.setName("option1").setDescription("Option 1").setRequired(true).setMaxLength(80))
            .addStringOption(o => o.setName("option2").setDescription("Option 2").setRequired(true).setMaxLength(80))
            .addStringOption(o => o.setName("option3").setDescription("Option 3").setRequired(false).setMaxLength(80))
            .addStringOption(o => o.setName("option4").setDescription("Option 4").setRequired(false).setMaxLength(80))
            .addStringOption(o => o.setName("option5").setDescription("Option 5").setRequired(false).setMaxLength(80))
            .addStringOption(o => o.setName("option6").setDescription("Option 6").setRequired(false).setMaxLength(80))
            .addStringOption(o => o.setName("option7").setDescription("Option 7").setRequired(false).setMaxLength(80))
            .addStringOption(o => o.setName("option8").setDescription("Option 8").setRequired(false).setMaxLength(80))
            .addStringOption(o => o.setName("option9").setDescription("Option 9").setRequired(false).setMaxLength(80))
            .addStringOption(o => o.setName("option10").setDescription("Option 10").setRequired(false).setMaxLength(80))
            .addIntegerOption(o => o.setName("duration").setDescription("Minutes until auto-close (optional)").setRequired(false).setMinValue(1).setMaxValue(1440)),

        new SlashCommandBuilder().setName("giveaway").setDescription("Start a giveaway")
            .addStringOption(o => o.setName("prize").setDescription("Prize").setRequired(true).setMaxLength(200))
            .addIntegerOption(o => o.setName("duration").setDescription("Duration in minutes").setRequired(true).setMinValue(1).setMaxValue(10080))
            .addIntegerOption(o => o.setName("winners").setDescription("Number of winners (default 1)").setRequired(false).setMinValue(1).setMaxValue(20))
            .addRoleOption(o => o.setName("required_role").setDescription("Role required to join (optional)").setRequired(false))
            .addChannelOption(o => o.setName("channel").setDescription("Channel to post in (default this channel)").setRequired(false)),
        new SlashCommandBuilder().setName("giveaway-end").setDescription("End a giveaway early")
            .addStringOption(o => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true)),
        new SlashCommandBuilder().setName("giveaway-reroll").setDescription("Reroll a giveaway winner")
            .addStringOption(o => o.setName("message_id").setDescription("Giveaway message ID").setRequired(true)),

        new SlashCommandBuilder().setName("suggestion-approve").setDescription("Approve a suggestion")
            .addStringOption(o => o.setName("message_id").setDescription("Suggestion message ID").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("suggestion-deny").setDescription("Deny a suggestion")
            .addStringOption(o => o.setName("message_id").setDescription("Suggestion message ID").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

        new SlashCommandBuilder().setName("roles").setDescription("List all server roles (staff-only)"),
        new SlashCommandBuilder().setName("serverinfo").setDescription("Show information about this server"),
        new SlashCommandBuilder().setName("afk").setDescription("Set yourself as AFK")
            .addStringOption(o => o.setName("reason").setDescription("Why are you AFK?").setRequired(false).setMaxLength(200)),
        new SlashCommandBuilder().setName("av").setDescription("Show your avatar or another user's avatar")
            .addUserOption(o => o.setName("user").setDescription("User (leave empty for yourself)").setRequired(false)),

        new SlashCommandBuilder().setName("nick").setDescription("Set your own nickname")
            .addStringOption(o => o.setName("name").setDescription("Your new nickname (leave empty to reset)").setRequired(false).setMaxLength(32)),

        new SlashCommandBuilder().setName("nickname").setDescription("Change or clear a member's nickname")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addStringOption(o => o.setName("name").setDescription("New nickname (leave empty to reset)").setRequired(false).setMaxLength(32)),

        new SlashCommandBuilder().setName("close").setDescription("Close the current ticket")
            .addStringOption(o => o.setName("reason").setDescription("Reason for closing").setRequired(false).setMaxLength(400)),
        new SlashCommandBuilder().setName("closeticket").setDescription("Close the current ticket")
            .addStringOption(o => o.setName("reason").setDescription("Reason for closing").setRequired(false).setMaxLength(400)),
        new SlashCommandBuilder().setName("ticketclose").setDescription("Close the current ticket")
            .addStringOption(o => o.setName("reason").setDescription("Reason for closing").setRequired(false).setMaxLength(400)),

        new SlashCommandBuilder().setName("ticket").setDescription("Manage the current ticket")
            .addSubcommand(s => s.setName("add").setDescription("Add a user to the current ticket")
                .addUserOption(o => o.setName("user").setDescription("User to add").setRequired(true)))
            .addSubcommand(s => s.setName("remove").setDescription("Remove a user from the current ticket")
                .addUserOption(o => o.setName("user").setDescription("User to remove").setRequired(true)))
            .addSubcommand(s => s.setName("rename").setDescription("Rename the current ticket")
                .addStringOption(o => o.setName("name").setDescription("New channel name").setRequired(true).setMaxLength(90)))
            .addSubcommand(s => s.setName("claim").setDescription("Claim the current ticket"))
            .addSubcommand(s => s.setName("unclaim").setDescription("Unclaim the current ticket")),

        new SlashCommandBuilder().setName("botinfo").setDescription("Show information about this bot"),
        new SlashCommandBuilder().setName("stats").setDescription("Alias for /botinfo"),
        new SlashCommandBuilder().setName("ping").setDescription("Check the bot's latency"),
        new SlashCommandBuilder().setName("uptime").setDescription("Show how long the bot has been running"),
        new SlashCommandBuilder().setName("invite").setDescription("Get the bot's invite link"),
        new SlashCommandBuilder().setName("membercount").setDescription("Show the member count breakdown"),
        new SlashCommandBuilder().setName("userinfo").setDescription("Show info about a user")
            .addUserOption(o => o.setName("user").setDescription("User (leave empty for yourself)").setRequired(false)),
        new SlashCommandBuilder().setName("roleinfo").setDescription("Show info about a role")
            .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),
        new SlashCommandBuilder().setName("banner").setDescription("Show a user's banner")
            .addUserOption(o => o.setName("user").setDescription("User (leave empty for yourself)").setRequired(false)),
        new SlashCommandBuilder().setName("history").setDescription("Show recent moderation history for a user")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)),

        new SlashCommandBuilder().setName("slowmode").setDescription("Set channel slowmode (0 to disable)")
            .addIntegerOption(o => o.setName("seconds").setDescription("Seconds (0-21600)").setRequired(true).setMinValue(0).setMaxValue(21600)),
        new SlashCommandBuilder().setName("lock").setDescription("Lock the current channel for @everyone")
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(300)),
        new SlashCommandBuilder().setName("unlock").setDescription("Unlock the current channel")
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false).setMaxLength(300)),
        new SlashCommandBuilder().setName("purge").setDescription("Bulk delete messages in this channel")
            .addIntegerOption(o => o.setName("amount").setDescription("Number of messages (1-100)").setRequired(true).setMinValue(1).setMaxValue(100))
            .addUserOption(o => o.setName("user").setDescription("Only delete messages from this user (optional)").setRequired(false)),
        new SlashCommandBuilder().setName("deafen").setDescription("Server-deafen a member in voice")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("undeafen").setDescription("Remove server-deafen")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("moveall").setDescription("Move everyone in your voice channel to another")
            .addChannelOption(o => o.setName("channel").setDescription("Target voice channel").setRequired(true)
                .addChannelTypes(ChannelType.GuildVoice, ChannelType.GuildStageVoice)),
        new SlashCommandBuilder().setName("announce").setDescription("Send an announcement as the bot")
            .addChannelOption(o => o.setName("channel").setDescription("Target channel").setRequired(true)
                .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addStringOption(o => o.setName("message").setDescription("Announcement text").setRequired(true).setMaxLength(2000)),
        new SlashCommandBuilder().setName("addrole").setDescription("Add a role to a member")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),
        new SlashCommandBuilder().setName("removerole").setDescription("Remove a role from a member")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addRoleOption(o => o.setName("role").setDescription("Role").setRequired(true)),
        new SlashCommandBuilder().setName("snipe").setDescription("Show the most recently deleted message in this channel"),

        new SlashCommandBuilder().setName("antinuke").setDescription("Anti-Nuke settings")
            .addSubcommand(s => s.setName("status").setDescription("Show anti-nuke status"))
            .addSubcommand(s => s.setName("enable").setDescription("Enable anti-nuke"))
            .addSubcommand(s => s.setName("disable").setDescription("Disable anti-nuke"))
            .addSubcommand(s => s.setName("threshold").setDescription("Set trigger threshold")
                .addIntegerOption(o => o.setName("count").setDescription("Trigger after this many events (2-20)").setRequired(true).setMinValue(2).setMaxValue(20)))
            .addSubcommand(s => s.setName("whitelist-add").setDescription("Add user to anti-nuke whitelist")
                .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)))
            .addSubcommand(s => s.setName("whitelist-remove").setDescription("Remove user from whitelist")
                .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)))
            .addSubcommand(s => s.setName("whitelist-list").setDescription("List whitelisted users"))
            .addSubcommand(s => s.setName("watchlist").setDescription("Show users on 24h rejoin watch"))
            .addSubcommand(s => s.setName("unwatch").setDescription("Remove a user from the rejoin watch")
                .addUserOption(o => o.setName("user").setDescription("User").setRequired(true)))
            .addSubcommand(s => s.setName("reset").setDescription("Reset all counters"))
    ];
    return cmds.map(c => c.toJSON());
}

let _slashCache = null;
let _slashHash = null;
function getSlashCommandsCached() {
    const json = getSlashCommands();
    const hash = crypto.createHash("md5").update(JSON.stringify(json)).digest("hex");
    if (!_slashCache || _slashHash !== hash) { _slashCache = json; _slashHash = hash; }
    return _slashCache;
}

async function registerCommands(guild) {
    try {
        const cmds = getSlashCommandsCached();
        await guild.commands.set(cmds);
    } catch (e) { console.error("registerCommands:", guild.name, e.message); }
}

async function registerCustomCommandSlash(guild, name, cc) {
    try {
        const cmd = new SlashCommandBuilder().setName(name).setDescription("Custom command");
        await guild.commands.create(cmd.toJSON());
    } catch (e) { console.error("registerCustomCommandSlash:", e.message); }
}

async function deleteCustomCommandSlash(guild, name) {
    try {
        const cmds = await guild.commands.fetch();
        const existing = cmds.find(c => c.name === name);
        if (existing) await existing.delete();
    } catch (e) { console.error("deleteCustomCommandSlash:", e.message); }
}

// ==========================================
// READY
// ==========================================

client.once("ready", async () => {
    console.log("--------------------------------");
    console.log("Logged in as " + client.user.tag);
    console.log("Servers: " + client.guilds.cache.size);

    if (!client.options.intents.has(GatewayIntentBits.MessageContent)) {
        console.error("⚠️  MESSAGE CONTENT INTENT IS DISABLED!");
        console.error("   → Enable it in Discord Developer Portal (Bot tab)");
    } else {
        console.log("✅ Message Content intent enabled — prefix commands will work.");
    }
    console.log("--------------------------------");

    const jobs = [];
    for (const guild of client.guilds.cache.values()) {
        getGuildConfig(guild.id);
        jobs.push(registerCommands(guild));
    }
    await Promise.all(jobs);

    client.user.setActivity("Eagle County Roleplay | " + BOT_VERSION);

    for (const guild of client.guilds.cache.values()) {
        const gc = getGuildConfig(guild.id);
        const now = Date.now();
        let changed = false;
        for (const [uid, e] of Object.entries(gc.antinuke.watchlist)) {
            if (now > e) { delete gc.antinuke.watchlist[uid]; changed = true; }
        }
        for (const [gid, g] of Object.entries(gc.giveaways || {})) {
            if (g.ended) continue;
            const remaining = g.endsAt - now;
            setTimeout(() => endGiveaway(gid), remaining > 0 ? remaining : 1000).unref?.();
        }
        if (changed) saveConfig();
    }

    setInterval(() => {
        const now = Date.now();
        for (const [k, v] of _recentPingedMessages) if (now - v.at > 10 * 60 * 1000) _recentPingedMessages.delete(k);
        for (const [id, p] of polls) if (p.ended) polls.delete(id);
        for (const [k, v] of _memberTierCache) if (now - v.at > _tierCacheTTL * 4) _memberTierCache.delete(k);
        for (const [k, v] of _pendingCloseConfirmations) if (now > v.expiresAt) _pendingCloseConfirmations.delete(k);
        for (const [k, v] of _snipeCache) if (now - v.at > SNIPE_TTL) _snipeCache.delete(k);
        // Clean old votes
        for (const guild of client.guilds.cache.values()) {
            const gc = getGuildConfig(guild.id);
            for (const [id, s] of Object.entries(gc.suggestions || {})) {
                if (s.createdAt && now - s.createdAt > VOTE_TTL && s.status !== "pending") delete gc.suggestions[id];
            }
            for (const [id, f] of Object.entries(gc.staffFeedback || {})) {
                if (f.createdAt && now - f.createdAt > VOTE_TTL) delete gc.staffFeedback[id];
            }
        }
    }, 10 * 60 * 1000).unref?.();

    flushSave();
});

client.on("guildCreate", async guild => {
    getGuildConfig(guild.id);
    await registerCommands(guild);
});

// ==========================================
// DM TEMPLATES
// ==========================================

function buildTemplateDM(guild, key, vars) {
    const gc = getGuildConfig(guild.id);
    const raw = gc.dmTemplates[key] || "You have received a notification from **{server}**.";
    const text = templateReplace(raw, { server: guild.name, ...vars });
    const titles = {
        accept: "Application Accepted",
        deny: "Application Denied",
        promote: "You Have Been Promoted",
        demote: "You Have Been Demoted",
        infract: "Infraction Notice"
    };
    return new EmbedBuilder()
        .setTitle(titles[key] || "Notice")
        .setDescription(text)
        .setColor(key === "demote" || key === "infract" || key === "deny" ? 0xED4245 : 0x57F287)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined })
        .setTimestamp();
}

async function tryDM(user, embed) {
    try { await user.send({ embeds: [embed] }); return true; } catch { return false; }
}

// ==========================================
// SETUP MENU
// ==========================================

function fmtCh(gc, k)   { return gc[k] ? "<#" + gc[k] + ">" : "❌ Not set"; }
function fmtRole(gc, k) { return gc[k] ? "<@&" + gc[k] + ">" : "❌ Not set"; }
function fmtRoleList(a) { return (!a || !a.length) ? "❌ None" : a.map(id => "<@&" + id + ">").join(", "); }

function buildSetupEmbed(guild) {
    const gc = getGuildConfig(guild.id);
    const an = gc.antinuke;
    const am = gc.automod;
    const watchCount = Object.values(an.watchlist).filter(e => Date.now() < e).length;
    const afkCount = Object.keys(gc.afk).length;
    const activeGiveaways = Object.values(gc.giveaways || {}).filter(g => !g.ended).length;
    const customCount = Object.keys(gc.customCommands || {}).length;

    return new EmbedBuilder()
        .setTitle("⚙️ " + guild.name + " — Setup Menu (" + BOT_VERSION + ")")
        .setDescription("Use the buttons below to configure each section.")
        .setColor(WEBHOOK_COLOR)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
            {
                name: "📌 Status",
                value:
                    "**Prefix:** `" + gc.prefix + "` • **Webhook:** " + (gc.webhookUrl ? "✅" : "❌") + "\n" +
                    "**Anti-Nuke:** " + (an.enabled ? "✅" : "❌") + " • **Auto-Mod:** " + (am.extremeSweatEnabled || am.ghostPingEnabled || am.linkFilterEnabled ? "✅" : "❌") + "\n" +
                    "**HR Ping:** " + (gc.hrPingRoleId ? "<@&" + gc.hrPingRoleId + ">" : "❌") + " • **AFK:** " + afkCount + " • **Giveaways:** " + activeGiveaways + " • **Custom Cmds:** " + customCount,
                inline: false
            },
            {
                name: "🎭 Role Tiers",
                value:
                    "**Staff:** " + fmtRoleList(gc.staffRoles) + "\n" +
                    "**Admin:** " + fmtRoleList(gc.adminRoles) + "\n" +
                    "**⭐ High Rank:** " + fmtRoleList(gc.highRankRoles) + "\n" +
                    "**Management:** " + fmtRoleList(gc.managementRoles),
                inline: false
            },
            {
                name: "📁 Key Channels",
                value:
                    "**Log:** " + fmtCh(gc, "logChannelId") + " • **Staff Log:** " + fmtCh(gc, "staffLogChannelId") + "\n" +
                    "**HR Log:** " + fmtCh(gc, "hrLogChannelId") + " • **Welcome:** " + fmtCh(gc, "welcomeChannelId") + "\n" +
                    "**Transcript:** " + fmtCh(gc, "transcriptChannelId") + " • **Suggestions:** " + fmtCh(gc, "suggestionChannelId") + "\n" +
                    "**Staff FB:** " + fmtCh(gc, "staffFeedbackChannelId"),
                inline: false
            },
            {
                name: "🎫 Tickets",
                value:
                    "**Support Cat:** " + (gc.ticketSupportCategoryId ? "<#" + gc.ticketSupportCategoryId + ">" : "❌") + " • **Ping:** " + fmtRole(gc, "ticketSupportPingRoleId") + "\n" +
                    "**High Rank Cat:** " + (gc.ticketHighRankCategoryId ? "<#" + gc.ticketHighRankCategoryId + ">" : "❌") + " • **Ping:** " + fmtRole(gc, "ticketHighRankPingRoleId"),
                inline: false
            }
        )
        .setFooter({ text: BOT_VERSION + " • " + guild.name, iconURL: guild.iconURL() || undefined })
        .setTimestamp();
}

function buildSetupRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_channels").setLabel("Channels").setEmoji("📁").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_roles").setLabel("Role Tiers").setEmoji("🎭").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_tickets").setLabel("Tickets").setEmoji("🎫").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_automod").setLabel("Auto-Mod").setEmoji("🤖").setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_perms").setLabel("Permissions").setEmoji("🔐").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_antinuke").setLabel("Anti-Nuke").setEmoji("🛡️").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_customcommands").setLabel("Custom Commands").setEmoji("🛠️").setStyle(ButtonStyle.Success)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_general").setLabel("General").setEmoji("🔤").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_dm_templates").setLabel("DM Templates").setEmoji("✉️").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_post_tickets").setLabel("Post Tickets").setEmoji("🎫").setStyle(ButtonStyle.Success)
        )
    ];
}

function buildChannelsMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ch_log").setLabel("Main Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_stafflog").setLabel("Staff Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_hrlog").setLabel("HR Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_ticketlog").setLabel("Ticket Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_transcript").setLabel("Transcripts").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ch_welcome").setLabel("Welcome").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_suggestions").setLabel("Suggestions").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_stafffb").setLabel("Staff FB").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildRolesMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_role_staff").setLabel("Staff").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_admin").setLabel("Admin").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_highrank").setLabel("⭐ High Rank").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_role_management").setLabel("Management").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_role_exempt").setLabel("Exempt").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_role_accept").setLabel("Accept").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_hrping").setLabel("HR Ping Role").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_clear_staff").setLabel("Clear Staff").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_clear_admin").setLabel("Clear Admin").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_clear_highrank").setLabel("Clear HR").setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_clear_management").setLabel("Clear Mgmt").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_clear_exempt").setLabel("Clear Exempt").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_clear_accept").setLabel("Clear Accept").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildTicketsMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ticket_support_cat").setLabel("Support Cat").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ticket_support_ping").setLabel("Support Ping").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ticket_high_cat").setLabel("HighRank Cat").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ticket_high_ping").setLabel("HighRank Ping").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ticket_ping_management").setLabel("Auto-Ping Mgmt").setEmoji("🛠️").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildAutomodMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_am_swear_toggle").setLabel("Swear Filter").setEmoji("🤬").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_am_swear_edit").setLabel("Edit Swear List").setEmoji("✏️").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_am_ghost_toggle").setLabel("Ghost Ping").setEmoji("👻").setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_am_link_toggle").setLabel("Link Filter").setEmoji("🔗").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_am_link_wl").setLabel("Link Whitelist").setEmoji("✅").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_am_link_viewwl").setLabel("View Whitelist").setEmoji("📋").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_am_ignored").setLabel("Ignored Channels").setEmoji("🔇").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildGeneralMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_prefix").setLabel("Prefix").setEmoji("🔤").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_webhook").setLabel("Webhook").setEmoji("🔗").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildAntinukeMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_an_toggle").setLabel("Toggle").setEmoji("🔁").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_an_threshold").setLabel("Threshold").setEmoji("🔢").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_an_whitelist").setLabel("Whitelist +").setEmoji("✅").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_an_unwhitelist").setLabel("Unwhitelist").setEmoji("❌").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_an_list").setLabel("Show WL").setEmoji("📋").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_an_watchlist").setLabel("Watchlist").setEmoji("👁️").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_an_reset").setLabel("Reset").setEmoji("♻️").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildTemplatesMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_tpl_accept").setLabel("Accept DM").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_tpl_deny").setLabel("Deny DM").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_tpl_promote").setLabel("Promote DM").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_tpl_demote").setLabel("Demote DM").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_tpl_infract").setLabel("Infract DM").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildCustomCommandsRows(hasCommands) {
    const rows = [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_cc_add").setLabel("Add Command").setEmoji("➕").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("setup_cc_list").setLabel("List Commands").setEmoji("📋").setStyle(ButtonStyle.Secondary)
        )
    ];
    if (hasCommands) {
        rows.push(new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_cc_edit_select").setLabel("Edit Command").setEmoji("✏️").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_cc_delete_select").setLabel("Delete Command").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_cc_clear").setLabel("Clear All").setEmoji("🧨").setStyle(ButtonStyle.Danger)
        ));
    }
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
    ));
    return rows;
}

function buildCustomCommandsEmbed(guild) {
    const gc = getGuildConfig(guild.id);
    const cc = gc.customCommands || {};
    const names = Object.keys(cc);

    return new EmbedBuilder()
        .setTitle("🛠️ Custom Commands")
        .setColor(WEBHOOK_COLOR)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .setDescription(
            "Create custom commands that send a **specific text** or **embed** when a user types them.\n\n" +
            "**How it works:**\n" +
            "> 1. Click **Add Command**\n" +
            "> 2. Fill in: name, response, type (text/embed), color, delete trigger\n" +
            "> 3. Save — users can run it with `/" + "name` or `" + gc.prefix + "name`\n\n" +
            (names.length
                ? "**Current Custom Commands (" + names.length + "):**\n" + names.map(n => "• `" + gc.prefix + n + "` → " + (cc[n].type === "embed" ? "embed" : "text")).join("\n")
                : "*No custom commands yet.*")
        )
        .setFooter({ text: BOT_VERSION + " • " + guild.name, iconURL: guild.iconURL() || undefined })
        .setTimestamp();
}

const PERM_GROUPS = {
    setup: { name: "⚙️ Setup & Config", commands: ["setup", "setprefix", "setuptickets", "set-webhook", "remove-webhook", "antinuke", "customcommand"] },
    hr:    { name: "👑 HR / Applications", commands: ["acceptsetup", "accept", "deny", "promote", "demote", "infract"] },
    mod:   { name: "🔨 Moderation & Utility", commands: ["mute", "unmute", "warn", "kick", "ban", "unban", "roles", "history", "slowmode", "lock", "unlock", "purge", "deafen", "undeafen", "moveall", "announce", "addrole", "removerole", "nickname", "nick", "snipe", "ticket"] },
    logs:  { name: "📝 Logging", commands: ["loguser", "robloxhistory"] },
    events:{ name: "🎉 Events", commands: ["poll", "giveaway", "giveaway-end", "giveaway-reroll", "suggestion-approve", "suggestion-deny"] },
    public:{ name: "🌐 Public & Fun", commands: ["suggest", "staff-feedback", "help", "serverinfo", "afk", "av", "botinfo", "ping", "uptime", "invite", "membercount", "userinfo", "roleinfo", "banner", "stats", "close", "closeticket", "ticketclose"] }
};

function buildPermsMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_perms_group_setup").setLabel("Setup").setEmoji("⚙️").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_perms_group_hr").setLabel("HR").setEmoji("👑").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_perms_group_mod").setLabel("Mod & Util").setEmoji("🔨").setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_perms_group_logs").setLabel("Logging").setEmoji("📝").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_perms_group_events").setLabel("Events").setEmoji("🎉").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_perms_group_public").setLabel("Public").setEmoji("🌐").setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_perms_reset").setLabel("Reset All").setEmoji("♻️").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildPermsGroupRows(groupKey) {
    const group = PERM_GROUPS[groupKey];
    if (!group) return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setStyle(ButtonStyle.Danger)
    )];
    const rows = [];
    let row = new ActionRowBuilder(), n = 0;
    for (const cmd of group.commands) {
        row.addComponents(new ButtonBuilder().setCustomId("setup_perm_edit_" + cmd).setLabel("/" + cmd).setStyle(ButtonStyle.Secondary));
        if (++n === 5) { rows.push(row); row = new ActionRowBuilder(); n = 0; }
    }
    if (n > 0) rows.push(row);
    rows.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("setup_perms").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
    ));
    return rows;
}

const TIER_LABEL = { staff: "🎭 Staff", admin: "🔨 Admin", highrank: "⭐ High Rank", management: "🛡️ Management", everyone: "🌐 Everyone" };
const fmtTiers = tiers => tiers.map(t => TIER_LABEL[t] || t).join(", ");

function permToggleRows(cmd, currentTiers) {
    const mk = (key, label) => new ButtonBuilder()
        .setCustomId("setup_perm_toggle_" + cmd + "_" + key)
        .setLabel(label)
        .setStyle(currentTiers.includes(key) ? ButtonStyle.Success : ButtonStyle.Secondary);
    return [
        new ActionRowBuilder().addComponents(
            mk("staff", "🎭 Staff"), mk("admin", "🔨 Admin"),
            mk("highrank", "⭐ High Rank"), mk("management", "🛡️ Management")
        ),
        new ActionRowBuilder().addComponents(
            mk("everyone", "🌐 Everyone"),
            new ButtonBuilder().setCustomId("setup_perm_reset_" + cmd).setLabel("Reset").setEmoji("♻️").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_perms").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

async function showPermsOverview(interaction) {
    const guildId = interaction.guild.id;
    const lines = [];
    for (const g of Object.values(PERM_GROUPS)) {
        lines.push("**" + g.name + "**");
        for (const cmd of g.commands) lines.push("`/" + cmd + "` → " + fmtTiers(getRequiredTiers(guildId, cmd)));
        lines.push("");
    }
    const embed = new EmbedBuilder().setTitle("🔐 Permission Configuration")
        .setDescription("Tiers (higher inherits lower): 🛡️ Mgmt → ⭐ High Rank → 🔨 Admin → 🎭 Staff\n\n" + lines.join("\n"))
        .setColor(WEBHOOK_COLOR).setTimestamp();
    await interaction.update({ embeds: [embed], components: buildPermsMenuRows() });
}

async function updateSetupMessage(interaction, view) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    let embed, rows;

    if (view === "main") { embed = buildSetupEmbed(guild); rows = buildSetupRows(); }
    else if (view === "channels") {
        embed = new EmbedBuilder().setTitle("📁 Channel Configuration")
            .setDescription("Set each channel using the buttons below.")
            .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL()).setTimestamp();
        rows = buildChannelsMenuRows();
    }
    else if (view === "roles") {
        embed = new EmbedBuilder().setTitle("🎭 Role Tiers")
            .setDescription("Hierarchy: 🛡️ Management → ⭐ High Rank → 🔨 Admin → 🎭 Staff\n\nSet the roles for each tier.\n**HR Ping Role** gets pinged when the extreme swear filter triggers.")
            .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL()).setTimestamp();
        rows = buildRolesMenuRows();
    }
    else if (view === "tickets") {
        embed = new EmbedBuilder().setTitle("🎫 Ticket Configuration")
            .setDescription("Support Category + Support Ping\nHigh Rank Category + High Rank Ping (Management auto-pinged)")
            .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL()).setTimestamp();
        rows = buildTicketsMenuRows();
    }
    else if (view === "templates") {
        embed = new EmbedBuilder().setTitle("✉️ DM Templates")
            .setDescription(
                "Vars: `{server}` `{rank}` `{type}` `{reason}` `{notes}`\n\n" +
                "**Accept:**\n" + gc.dmTemplates.accept +
                "\n\n**Deny:**\n" + gc.dmTemplates.deny +
                "\n\n**Promote:**\n" + gc.dmTemplates.promote +
                "\n\n**Demote:**\n" + gc.dmTemplates.demote +
                "\n\n**Infract:**\n" + gc.dmTemplates.infract)
            .setColor(WEBHOOK_COLOR).setTimestamp();
        rows = buildTemplatesMenuRows();
    }
    else if (view === "antinuke") {
        const an = gc.antinuke;
        embed = new EmbedBuilder().setTitle("🛡️ Anti-Nuke Settings")
            .setDescription(
                "**Threshold:** " + an.threshold + " / " + (an.windowMs / 1000) + "s\n" +
                "On trigger: strip all roles + kick + 24h rejoin watch\n" +
                "Rejoin during watch: re-strip + 24h timeout\n\n" +
                "**Enabled:** " + (an.enabled ? "✅" : "❌") + "\n**Whitelisted:** " + an.whitelist.length
            )
            .setColor(0xED4245).setThumbnail(guild.iconURL()).setTimestamp();
        rows = buildAntinukeMenuRows();
    }
    else if (view === "automod") {
        const am = gc.automod;
        embed = new EmbedBuilder().setTitle("🤖 Auto-Mod Settings")
            .setDescription(
                "**Extreme Swear Filter:** " + (am.extremeSweatEnabled ? "✅" : "❌") + " — " + am.extremeSweatList.length + " words\n" +
                "**Ghost Ping Warn:** " + (am.ghostPingEnabled ? "✅" : "❌") + "\n" +
                "**Link Filter:** " + (am.linkFilterEnabled ? "✅" : "❌") + " — " + am.linkWhitelistChannelIds.length + " whitelisted channels\n" +
                "**Ignored Channels:** " + (am.ignoredChannelIds.length || 0) + "\n\n" +
                "**On extreme swear:** instant 60min mute + HR ping\n" +
                "**On ghost ping:** auto-warn\n" +
                "**On link outside whitelist:** blocked + logged"
            )
            .setColor(0xED4245).setThumbnail(guild.iconURL()).setTimestamp();
        rows = buildAutomodMenuRows();
    }
    else if (view === "general") {
        embed = new EmbedBuilder().setTitle("🔤 General Settings")
            .setDescription("**Prefix:** `" + gc.prefix + "`\n**Webhook:** " + (gc.webhookUrl ? "✅ Configured" : "❌ Not set"))
            .setColor(WEBHOOK_COLOR).setTimestamp();
        rows = buildGeneralMenuRows();
    }
    else if (view === "customcommands") {
        embed = buildCustomCommandsEmbed(guild);
        rows = buildCustomCommandsRows(Object.keys(gc.customCommands || {}).length > 0);
    }
    await interaction.update({ embeds: [embed], components: rows });
}

// ==========================================
// POLL / GIVEAWAY
// ==========================================

function buildPollEmbed(question, options, votes, closed, durationMin) {
    const total = Object.values(votes).reduce((a, b) => a + b.length, 0);
    const lines = options.map((opt, i) => {
        const count = votes[i]?.length || 0;
        const pct = total ? Math.round((count / total) * 100) : 0;
        const filled = Math.round(pct / 10);
        const bar = "█".repeat(filled) + "░".repeat(10 - filled);
        return "**" + (i + 1) + ".** " + opt + "\n`" + bar + "` " + count + " vote" + (count === 1 ? "" : "s") + " (" + pct + "%)";
    }).join("\n\n");

    return new EmbedBuilder()
        .setTitle("📊 " + question)
        .setDescription(lines || "No options")
        .setColor(closed ? 0xED4245 : 0x5865F2)
        .setFooter({ text: total + " total vote" + (total === 1 ? "" : "s") + (closed ? " • CLOSED" : (durationMin ? " • closes in " + durationMin + "m" : "")) })
        .setTimestamp();
}

function buildPollRows(options, pollId, closed) {
    const rows = [];
    let row = new ActionRowBuilder(), n = 0;
    for (let i = 0; i < options.length; i++) {
        row.addComponents(new ButtonBuilder().setCustomId("poll_vote_" + pollId + "_" + i).setLabel(String(i + 1)).setStyle(ButtonStyle.Primary).setDisabled(closed));
        if (++n === 5) { rows.push(row); row = new ActionRowBuilder(); n = 0; }
    }
    if (n > 0) rows.push(row);
    return rows;
}

function buildGiveawayEmbed(giveaway, closed, winners) {
    const embed = new EmbedBuilder()
        .setTitle(closed ? "🎁 GIVEAWAY ENDED" : "🎁 GIVEAWAY")
        .setDescription(
            "**Prize:** " + giveaway.prize + "\n\n" +
            (closed
                ? (winners.length ? "**Winner" + (winners.length === 1 ? "" : "s") + ":** " + winners.map(id => "<@" + id + ">").join(", ") : "No valid entries.")
                : "Click **Join** to enter!\n**Ends:** <t:" + ((giveaway.endsAt / 1000) | 0) + ":R>")
        )
        .setColor(closed ? 0x57F287 : 0xFEE75C)
        .addFields(
            { name: "Hosted By", value: "<@" + giveaway.hostId + ">", inline: true },
            { name: "Entries", value: String(giveaway.entries.length), inline: true },
            { name: "Winners", value: String(giveaway.winners), inline: true }
        )
        .setFooter({ text: closed ? "Ended" : "Ends" })
        .setTimestamp(closed ? Date.now() : giveaway.endsAt);
    if (giveaway.requiredRoleId) embed.addFields({ name: "Required Role", value: "<@&" + giveaway.requiredRoleId + ">", inline: false });
    return embed;
}

function buildGiveawayRows(giveawayId, closed) {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("giveaway_join_" + giveawayId).setLabel(closed ? "Ended" : "Join Giveaway").setEmoji("🎉").setStyle(closed ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(closed)
    )];
}

async function endPoll(pollId) {
    const p = polls.get(pollId);
    if (!p || p.ended) return;
    p.ended = true;
    try {
        const channel = await client.channels.fetch(p.channelId).catch(() => null);
        if (!channel) return;
        const msg = await channel.messages.fetch(p.messageId).catch(() => null);
        if (!msg) return;
        await msg.edit({ embeds: [buildPollEmbed(p.question, p.options, p.votes, true, null)], components: buildPollRows(p.options, pollId, true) }).catch(() => {});
    } catch (e) { console.error("endPoll:", e); }
    finally { polls.delete(pollId); }
}

async function endGiveaway(giveawayId) {
    for (const gc of guildConfigCache.values()) {
        const g = gc.giveaways?.[giveawayId];
        if (!g) continue;
        if (g.ended) return;
        g.ended = true;

        const winners = [];
        const pool = [...g.entries];
        while (winners.length < g.winners && pool.length) winners.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
        g.winnerIds = winners;
        saveConfig();

        try {
            const channel = await client.channels.fetch(g.channelId).catch(() => null);
            if (!channel) return;
            const msg = await channel.messages.fetch(g.messageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [buildGiveawayEmbed(g, true, winners)], components: buildGiveawayRows(giveawayId, true) }).catch(() => {});

            if (winners.length) {
                channel.send({ content: "🎉 Congratulations " + winners.map(id => "<@" + id + ">").join(", ") + "! You won **" + g.prize + "**!" }).catch(() => {});
                Promise.all(winners.map(wid =>
                    client.users.fetch(wid).then(u => u.send({ embeds: [new EmbedBuilder().setTitle("🎉 You won a giveaway!")
                        .setDescription("You won **" + g.prize + "** in **" + (channel.guild?.name || "the server") + "**!")
                        .setColor(0x57F287).setTimestamp()] })).catch(() => {})
                )).catch(() => {});
            } else {
                channel.send({ content: "No valid entries for **" + g.prize + "** — no winner selected." }).catch(() => {});
            }
        } catch (e) { console.error("endGiveaway:", e); }
        return;
    }
}

async function rerollGiveaway(guild, messageId, interaction) {
    const gc = getGuildConfig(guild.id);
    const entry = Object.entries(gc.giveaways).find(([, g]) => g.messageId === messageId);
    if (!entry) return interaction.editReply({ embeds: [errorEmbed("Giveaway not found.")] });
    const [id, g] = entry;
    if (!g.ended) return interaction.editReply({ embeds: [errorEmbed("Giveaway hasn't ended yet.")] });
    if (!g.entries.length) return interaction.editReply({ embeds: [errorEmbed("No entries to reroll from.")] });
    const winner = g.entries[Math.floor(Math.random() * g.entries.length)];
    g.winnerIds = [winner];
    saveConfig();
    try {
        const channel = await client.channels.fetch(g.channelId).catch(() => null);
        if (channel) {
            const msg = await channel.messages.fetch(g.messageId).catch(() => null);
            if (msg) await msg.edit({ embeds: [buildGiveawayEmbed(g, true, [winner])], components: buildGiveawayRows(id, true) }).catch(() => {});
            channel.send({ content: "🎉 Reroll! New winner: <@" + winner + "> — **" + g.prize + "**!" }).catch(() => {});
        }
    } catch {}
    return interaction.editReply({ embeds: [successEmbed("Rerolled. New winner: <@" + winner + ">")] });
}

// ==========================================
// SHARED MODERATION
// ==========================================

async function doMute(guild, executorMember, targetMember, durationInput, reason) {
    if (!targetMember) return { ok: false, msg: "Member not found." };
    if (isExempt(targetMember)) return { ok: false, msg: "Target is exempt." };
    if (!canModerate(executorMember, targetMember)) return { ok: false, msg: "Role hierarchy blocks this." };
    const duration = parseDuration(durationInput);
    if (!duration) return { ok: false, msg: "Invalid duration. Example: 10m, 1h, 1d." };
    const limit = getLimitData(guild.id, executorMember.id);
    if (limit.mutes >= DAILY_LIMIT) return { ok: false, msg: "Daily mute limit reached (" + DAILY_LIMIT + ")." };
    try {
        await targetMember.timeout(duration, reason);
        limit.mutes++; saveConfig();
        recordHistory(guild.id, targetMember.id, { type: "mute", reason, moderator: executorMember.user.tag, at: Date.now(), guildId: guild.id, duration: durationInput });
        broadcast(guild, logEmbed("Member Muted",
            "**User:** " + targetMember + " (`" + targetMember.user.tag + "`)\n**Mod:** " + executorMember.user.tag + "\n**Duration:** " + durationInput + "\n**Reason:** " + reason), ["log", "staff", "webhook"]).catch(() => {});
        return { ok: true, msg: targetMember + " has been muted for **" + durationInput + "**." };
    } catch (e) { console.error("mute err:", e); return { ok: false, msg: "Failed to mute (permissions?)." }; }
}

async function doUnmute(guild, executorMember, targetMember, reason) {
    if (!targetMember) return { ok: false, msg: "Member not found." };
    try {
        await targetMember.timeout(null, reason);
        broadcast(guild, logEmbed("Member Unmuted", "**User:** " + targetMember + "\n**Mod:** " + executorMember.user.tag + "\n**Reason:** " + reason), ["log", "staff", "webhook"]).catch(() => {});
        return { ok: true, msg: targetMember + " has been unmuted." };
    } catch (e) { console.error("unmute err:", e); return { ok: false, msg: "Failed to unmute." }; }
}

async function doWarn(guild, executorMember, targetMember, reason) {
    if (!targetMember) return { ok: false, msg: "Member not found." };
    recordHistory(guild.id, targetMember.id, { type: "warn", reason, moderator: executorMember.user.tag, at: Date.now(), guildId: guild.id });
    broadcast(guild, logEmbed("Member Warned", "**User:** " + targetMember + "\n**Mod:** " + executorMember.user.tag + "\n**Reason:** " + reason, 0xFEE75C), ["log", "staff", "webhook"]).catch(() => {});
    targetMember.send({ embeds: [logEmbed("You were warned in " + guild.name, "**Reason:** " + reason, 0xFEE75C)] }).catch(() => {});
    return { ok: true, msg: targetMember + " has been warned." };
}

async function doKick(guild, executorMember, targetMember, reason) {
    if (!targetMember) return { ok: false, msg: "Member not found." };
    if (isExempt(targetMember)) return { ok: false, msg: "Target is exempt." };
    if (!canModerate(executorMember, targetMember)) return { ok: false, msg: "Role hierarchy blocks this." };
    const limit = getLimitData(guild.id, executorMember.id);
    if (limit.kicks >= DAILY_KICK_LIMIT) return { ok: false, msg: "Daily kick limit reached (" + DAILY_KICK_LIMIT + ")." };
    if (!targetMember.kickable) return { ok: false, msg: "I can't kick that member (hierarchy)." };
    try {
        await targetMember.kick(reason);
        limit.kicks++; saveConfig();
        recordHistory(guild.id, targetMember.id, { type: "kick", reason, moderator: executorMember.user.tag, at: Date.now(), guildId: guild.id });
        broadcast(guild, logEmbed("Member Kicked", "**User:** " + targetMember.user.tag + "\n**Mod:** " + executorMember.user.tag + "\n**Reason:** " + reason), ["log", "staff", "webhook"]).catch(() => {});
        targetMember.send({ embeds: [logEmbed("You were kicked from " + guild.name, "**Reason:** " + reason, 0xED4245)] }).catch(() => {});
        return { ok: true, msg: targetMember.user.tag + " has been kicked." };
    } catch (e) { console.error("kick err:", e); return { ok: false, msg: "Failed to kick." }; }
}

async function doBan(guild, executorMember, targetUser, reason, userId) {
    if (targetUser && isExempt(targetUser)) return { ok: false, msg: "Target is exempt." };
    if (targetUser && !canModerate(executorMember, targetUser)) return { ok: false, msg: "Role hierarchy blocks this." };
    const limit = getLimitData(guild.id, executorMember.id);
    if (limit.bans >= DAILY_BAN_LIMIT) return { ok: false, msg: "Daily ban limit reached (" + DAILY_BAN_LIMIT + ")." };
    try {
        let id, tag;
        if (userId) {
            id = userId;
            const u = await client.users.fetch(userId).catch(() => null);
            tag = u ? u.tag : userId;
            await guild.members.ban(userId, { reason });
        } else {
            if (!targetUser.bannable) return { ok: false, msg: "I can't ban that member (hierarchy)." };
            id = targetUser.id;
            tag = targetUser.user.tag;
            await targetUser.ban({ reason });
        }
        limit.bans++; saveConfig();
        recordHistory(guild.id, id, { type: "ban", reason, moderator: executorMember.user.tag, at: Date.now(), guildId: guild.id });
        broadcast(guild, logEmbed("Member Banned", "**User:** " + tag + "\n**Mod:** " + executorMember.user.tag + "\n**Reason:** " + reason), ["log", "staff", "webhook"]).catch(() => {});
        if (!userId && targetUser) targetUser.send({ embeds: [logEmbed("You were banned from " + guild.name, "**Reason:** " + reason, 0xED4245)] }).catch(() => {});
        return { ok: true, msg: tag + " has been banned." };
    } catch (e) { console.error("ban err:", e); return { ok: false, msg: "Failed to ban." }; }
}

async function doUnban(guild, executorMember, userId, reason) {
    try {
        const u = await client.users.fetch(userId);
        await guild.members.unban(userId, reason);
        recordHistory(guild.id, userId, { type: "unban", reason, moderator: executorMember.user.tag, at: Date.now(), guildId: guild.id });
        broadcast(guild, logEmbed("Member Unbanned", "**User:** " + u.tag + "\n**Mod:** " + executorMember.user.tag + "\n**Reason:** " + reason), ["log", "staff", "webhook"]).catch(() => {});
        return { ok: true, msg: u.tag + " has been unbanned." };
    } catch (e) { console.error("unban err:", e); return { ok: false, msg: "Failed to unban (check ID / user banned?)." }; }
}

async function doLogUser(guild, executor, username, punishment, reason, notes) {
    const meta = {
        warn: { label: "Warn", emoji: "⚠️", color: 0xFEE75C },
        kick: { label: "Kick", emoji: "👢", color: 0xE67E22 },
        ban:  { label: "Ban",  emoji: "🔨", color: 0xED4245 }
    }[punishment];

    const gc = getGuildConfig(guild.id);
    const key = username.toLowerCase();
    if (!gc.robloxLogs[key]) gc.robloxLogs[key] = [];
    gc.robloxLogs[key].unshift({
        punishment, reason, notes: notes || null,
        moderator: executor.tag, at: Date.now()
    });
    if (gc.robloxLogs[key].length > 100) gc.robloxLogs[key].length = 100;
    saveConfig();

    const embed = new EmbedBuilder()
        .setTitle(meta.emoji + " " + meta.label + " Logged")
        .setColor(meta.color)
        .addFields(
            { name: "Roblox Username", value: username, inline: true },
            { name: "Punishment", value: meta.label, inline: true },
            { name: "Moderator", value: executor.tag, inline: true },
            { name: "Reason", value: reason, inline: false }
        )
        .setFooter({ text: "Logged by " + executor.tag })
        .setTimestamp();
    if (notes) embed.addFields({ name: "Notes", value: notes.slice(0, 1024) });

    broadcast(guild, embed, ["staff", "log", "webhook"]).catch(() => {});
    return { ok: true, msg: "**" + meta.label + "** logged for **" + username + "**." };
}

async function doRobloxHistory(ctx, isSlash, username) {
    const guild = ctx.guild;
    const gc = getGuildConfig(guild.id);
    const key = username.toLowerCase();
    const logs = gc.robloxLogs[key];
    const embed = new EmbedBuilder().setTitle("📜 Roblox History — " + username).setColor(WEBHOOK_COLOR).setTimestamp();
    if (!logs || !logs.length) {
        embed.setDescription("No logged punishments for this Roblox user.");
    } else {
        embed.setDescription(logs.slice(0, 15).map((l, i) => {
            const meta = { warn: "⚠️", kick: "👢", ban: "🔨" }[l.punishment] || "•";
            return "**" + (i + 1) + ".** " + meta + " **" + l.punishment.toUpperCase() + "** — " + l.moderator + "\n> " + l.reason + " • <t:" + ((l.at / 1000) | 0) + ":R>" + (l.notes ? "\n> *" + l.notes + "*" : "");
        }).join("\n\n"));
    }
    return ctx.reply({ embeds: [embed] });
}

async function doAccept(guild, executor, targetUser, notes) {
    const gc = getGuildConfig(guild.id);
    let roleGiven = 0;
    if (gc.acceptRoleIds.length) {
        const member = await guild.members.fetch(targetUser.id).catch(() => null);
        if (member) for (const rid of gc.acceptRoleIds) { try { await member.roles.add(rid, "Accepted"); roleGiven++; } catch {} }
    }
    const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "accept", { notes: notes || "" }));
    recordHistory(guild.id, targetUser.id, { type: "accept", reason: notes || "No notes", moderator: executor.tag, at: Date.now(), guildId: guild.id });
    const embed = new EmbedBuilder().setTitle("Application Accepted").setColor(0x57F287)
        .addFields(
            { name: "User", value: targetUser.tag + " (`" + targetUser.id + "`)", inline: false },
            { name: "By", value: executor.tag, inline: true },
            { name: "Roles Given", value: String(roleGiven), inline: true },
            { name: "DM", value: dmSent ? "Yes" : "No", inline: true }
        ).setTimestamp();
    if (notes) embed.addFields({ name: "Notes", value: notes.slice(0, 1024) });
    broadcast(guild, embed, ["hr", "log", "webhook"]).catch(() => {});
    return { ok: true, msg: targetUser.tag + " has been accepted." + (dmSent ? " DM sent." : " (DM failed)") };
}

async function doDeny(guild, executor, targetUser, reason, notes) {
    const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "deny", { reason }));
    recordHistory(guild.id, targetUser.id, { type: "deny", reason, moderator: executor.tag, at: Date.now(), guildId: guild.id });
    const embed = new EmbedBuilder().setTitle("Application Denied").setColor(0xED4245)
        .addFields(
            { name: "User", value: targetUser.tag + " (`" + targetUser.id + "`)", inline: false },
            { name: "By", value: executor.tag, inline: true },
            { name: "DM", value: dmSent ? "Yes" : "No", inline: true },
            { name: "Reason", value: reason, inline: false }
        ).setTimestamp();
    if (notes) embed.addFields({ name: "Internal Notes", value: notes.slice(0, 1024) });
    broadcast(guild, embed, ["hr", "log", "webhook"]).catch(() => {});
    return { ok: true, msg: targetUser.tag + " has been denied." + (dmSent ? " DM sent." : " (DM failed)") };
}

async function doPromote(guild, executor, targetUser, rank, notes, role) {
    const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "promote", { rank, notes: notes || "" }));
    recordHistory(guild.id, targetUser.id, { type: "promote", reason: "Rank: " + rank, moderator: executor.tag, at: Date.now(), guildId: guild.id });
    if (role) {
        const member = await guild.members.fetch(targetUser.id).catch(() => null);
        if (member) {
            if (!canManageRole(executor.member || { guild, id: executor.id, roles: { highest: { position: 999 } }, user: executor }, role))
                return { ok: false, msg: "Cannot manage that role (hierarchy)." };
            try { await member.roles.add(role, "Promotion"); } catch (e) { console.error(e); }
        }
    }
    const embed = new EmbedBuilder().setTitle("Promotion").setColor(0x57F287)
        .addFields(
            { name: "User", value: targetUser.tag + " (`" + targetUser.id + "`)", inline: false },
            { name: "New Rank", value: rank, inline: true },
            { name: "By", value: executor.tag, inline: true },
            { name: "DM", value: dmSent ? "Yes" : "No", inline: true }
        ).setTimestamp();
    if (role) embed.addFields({ name: "Role Given", value: role.toString(), inline: true });
    if (notes) embed.addFields({ name: "Notes", value: notes.slice(0, 1024) });
    broadcast(guild, embed, ["hr", "log", "webhook"]).catch(() => {});
    return { ok: true, msg: targetUser.tag + " has been promoted to **" + rank + "**." };
}

async function doDemote(guild, executor, targetUser, rank, notes, role) {
    const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "demote", { rank, notes: notes || "" }));
    recordHistory(guild.id, targetUser.id, { type: "demote", reason: "Rank: " + rank, moderator: executor.tag, at: Date.now(), guildId: guild.id });
    if (role) {
        const member = await guild.members.fetch(targetUser.id).catch(() => null);
        if (member) {
            if (!canManageRole(executor.member || { guild, id: executor.id, roles: { highest: { position: 999 } }, user: executor }, role))
                return { ok: false, msg: "Cannot manage that role (hierarchy)." };
            try { await member.roles.remove(role, "Demotion"); } catch (e) { console.error(e); }
        }
    }
    const embed = new EmbedBuilder().setTitle("Demotion").setColor(0xED4245)
        .addFields(
            { name: "User", value: targetUser.tag + " (`" + targetUser.id + "`)", inline: false },
            { name: "New Rank", value: rank, inline: true },
            { name: "By", value: executor.tag, inline: true },
            { name: "DM", value: dmSent ? "Yes" : "No", inline: true }
        ).setTimestamp();
    if (role) embed.addFields({ name: "Role Removed", value: role.toString(), inline: true });
    if (notes) embed.addFields({ name: "Notes", value: notes.slice(0, 1024) });
    broadcast(guild, embed, ["hr", "log", "webhook"]).catch(() => {});
    return { ok: true, msg: targetUser.tag + " has been demoted to **" + rank + "**." };
}

async function doInfract(guild, executor, targetUser, type, reason, notes) {
    const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "infract", { type, reason, notes: notes || "" }));
    const colors = { warn: 0xFEE75C, strike: 0xED4245, demotion: 0xED4245, suspension: 0x992D22 };
    recordHistory(guild.id, targetUser.id, { type: "infract:" + type, reason, moderator: executor.tag, at: Date.now(), guildId: guild.id });
    const embed = new EmbedBuilder().setTitle("Infraction").setColor(colors[type] || 0xED4245)
        .addFields(
            { name: "User", value: targetUser.tag + " (`" + targetUser.id + "`)", inline: false },
            { name: "Type", value: type, inline: true },
            { name: "By", value: executor.tag, inline: true },
            { name: "DM", value: dmSent ? "Yes" : "No", inline: true },
            { name: "Reason", value: reason, inline: false }
        ).setTimestamp();
    if (notes) embed.addFields({ name: "Notes", value: notes.slice(0, 1024) });
    broadcast(guild, embed, ["hr", "log", "webhook"]).catch(() => {});
    return { ok: true, msg: targetUser.tag + " has been infracted: **" + type + "**." };
}

// ==========================================
// UTILITY
// ==========================================

async function cmdBotInfo(ctx) {
    const mem = process.memoryUsage();
    const guilds = client.guilds.cache.size;
    const users = client.guilds.cache.reduce((a, g) => a + g.memberCount, 0);
    const channels = client.channels.cache.size;

    await ctx.reply({ embeds: [new EmbedBuilder()
        .setTitle("🤖 " + client.user.username)
        .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
        .setColor(WEBHOOK_COLOR)
        .addFields(
            { name: "Version", value: BOT_VERSION, inline: true },
            { name: "Uptime", value: formatDuration(Date.now() - BOT_START_TIME), inline: true },
            { name: "Ping", value: client.ws.ping + "ms", inline: true },
            { name: "Servers", value: String(guilds), inline: true },
            { name: "Users", value: String(users), inline: true },
            { name: "Channels", value: String(channels), inline: true },
            { name: "discord.js", value: "v" + (djsVersion || "?"), inline: true },
            { name: "Node.js", value: process.version, inline: true },
            { name: "Memory", value: formatBytes(mem.heapUsed) + " / " + formatBytes(mem.heapTotal), inline: true }
        )
        .setFooter({ text: BOT_VERSION, iconURL: client.user.displayAvatarURL() })
        .setTimestamp()] });
}

async function cmdPing(ctx, isSlash) {
    const sent = Date.now();
    const m = await ctx.reply({ content: "🏓 Pinging...", withResponse: true });
    const rt = Date.now() - sent;
    const embed = new EmbedBuilder().setDescription("🏓 **Pong!**\n**WebSocket:** `" + client.ws.ping + "ms`\n**Roundtrip:** `" + rt + "ms`").setColor(0x57F287).setTimestamp();
    if (isSlash) await ctx.editReply({ content: "", embeds: [embed] });
    else m.edit({ content: "", embeds: [embed] }).catch(() => {});
}

async function cmdUptime(ctx) {
    await ctx.reply({ embeds: [new EmbedBuilder().setDescription("⏱️ **Uptime:** " + formatDuration(Date.now() - BOT_START_TIME) + "\n**Started:** <t:" + ((BOT_START_TIME / 1000) | 0) + ":R>").setColor(WEBHOOK_COLOR).setTimestamp()] });
}

async function cmdInvite(ctx) {
    const url = "https://discord.com/oauth2/authorize?client_id=" + client.user.id + "&permissions=8&scope=bot%20applications.commands";
    await ctx.reply({ embeds: [new EmbedBuilder().setTitle("🔗 Invite Link").setDescription("[Click here to invite me](" + url + ")").setColor(WEBHOOK_COLOR).setTimestamp()] });
}

async function cmdMemberCount(ctx) {
    const guild = ctx.guild;
    const total = guild.memberCount;
    const bots = guild.members.cache.filter(m => m.user.bot).size;
    const humans = total - bots;
    await ctx.reply({ embeds: [new EmbedBuilder().setTitle("👥 Member Count — " + guild.name).setColor(WEBHOOK_COLOR)
        .addFields(
            { name: "Total", value: String(total), inline: true },
            { name: "Humans (cached)", value: String(humans), inline: true },
            { name: "Bots (cached)", value: String(bots), inline: true }
        ).setTimestamp()] });
}

async function cmdUserInfo(ctx, isSlash, targetUser) {
    const guild = ctx.guild;
    const user = targetUser || (isSlash ? ctx.user : ctx.author);
    const member = await guild.members.fetch(user.id).catch(() => null);

    const embed = new EmbedBuilder()
        .setTitle("👤 " + user.tag)
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .setColor(member?.displayColor || WEBHOOK_COLOR)
        .addFields(
            { name: "Username", value: user.username, inline: true },
            { name: "Display Name", value: member?.displayName || user.username, inline: true },
            { name: "ID", value: "`" + user.id + "`", inline: true },
            { name: "Bot?", value: user.bot ? "Yes" : "No", inline: true },
            { name: "Account Created", value: "<t:" + ((user.createdTimestamp / 1000) | 0) + ":R>", inline: true }
        )
        .setFooter({ text: "Requested by " + (isSlash ? ctx.user.tag : ctx.author.tag) })
        .setTimestamp();
    if (member) {
        embed.addFields(
            { name: "Joined Server", value: member.joinedTimestamp ? "<t:" + ((member.joinedTimestamp / 1000) | 0) + ":R>" : "Unknown", inline: true },
            { name: "Highest Role", value: member.roles.highest.toString(), inline: true },
            { name: "Roles (" + (member.roles.cache.size - 1) + ")", value: member.roles.cache.filter(r => r.id !== guild.id).map(r => r.toString()).slice(0, 15).join(", ") || "None", inline: false }
        );
    }
    await ctx.reply({ embeds: [embed] });
}

async function cmdRoleInfo(ctx, role) {
    const guild = ctx.guild;
    const members = guild.members.cache.filter(m => m.roles.cache.has(role.id)).size;
    const perms = role.permissions.toArray().map(p => p.replace(/([A-Z])/g, " $1").toLowerCase());
    await ctx.reply({ embeds: [new EmbedBuilder().setTitle("🎭 Role — " + role.name)
        .setColor(role.hexColor !== "#000000" ? role.color : WEBHOOK_COLOR)
        .addFields(
            { name: "ID", value: "`" + role.id + "`", inline: true },
            { name: "Color", value: role.hexColor, inline: true },
            { name: "Position", value: String(role.position), inline: true },
            { name: "Hoisted", value: role.hoist ? "Yes" : "No", inline: true },
            { name: "Mentionable", value: role.mentionable ? "Yes" : "No", inline: true },
            { name: "Members (cached)", value: String(members), inline: true },
            { name: "Created", value: "<t:" + ((role.createdTimestamp / 1000) | 0) + ":R>", inline: true },
            { name: "Permissions", value: perms.length ? perms.slice(0, 25).map(p => "`" + p + "`").join(", ") : "None", inline: false }
        ).setTimestamp()] });
}

async function cmdBanner(ctx, targetUser) {
    const user = targetUser || ctx.user || ctx.author;
    const full = await client.users.fetch(user.id, { force: true }).catch(() => null);
    const banner = full?.bannerURL({ size: 1024 });
    if (!banner) return ctx.reply({ embeds: [errorEmbed("**" + user.tag + "** has no banner.")] });
    await ctx.reply({ embeds: [new EmbedBuilder().setTitle("🖼️ " + user.username + "'s Banner").setImage(banner).setColor(WEBHOOK_COLOR).setTimestamp()] });
}

async function cmdHistory(ctx, targetUser) {
    const guild = ctx.guild;
    const gc = getGuildConfig(guild.id);
    const entries = gc.history[targetUser.id] || [];
    const guildEntries = entries.filter(e => e.guildId === guild.id);

    const embed = new EmbedBuilder().setTitle("📜 History — " + targetUser.tag).setColor(WEBHOOK_COLOR).setThumbnail(targetUser.displayAvatarURL()).setFooter({ text: "Last 15 • " + guild.name }).setTimestamp();
    if (!guildEntries.length) embed.setDescription("No history found.");
    else embed.setDescription(guildEntries.slice(0, 15).map((e, i) => "**" + (i + 1) + ". " + e.type.toUpperCase() + "** — " + e.moderator + "\n> " + (e.reason || "No reason") + " • <t:" + ((e.at / 1000) | 0) + ":R>").join("\n\n"));
    await ctx.reply({ embeds: [embed] });
}

async function cmdRoles(ctx) {
    const guild = ctx.guild;
    await guild.members.fetch().catch(() => {});
    const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);
    const lines = roles.map(r => r.toString() + " — `" + r.members.size + " members`");
    const chunks = [];
    let current = "";
    for (const l of lines) {
        if ((current + "\n" + l).length > 3800) { chunks.push(current); current = l; }
        else current += (current ? "\n" : "") + l;
    }
    if (current) chunks.push(current);
    if (!chunks.length) chunks.push("None");
    const embed = new EmbedBuilder().setTitle("📋 Roles — " + roles.length + " total").setColor(WEBHOOK_COLOR).setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined }).setDescription("**Total members:** " + guild.memberCount + "\n\n" + chunks[0]).setTimestamp();
    await ctx.reply({ embeds: [embed] });
    for (let i = 1; i < chunks.length; i++) {
        await ctx.followUp({ embeds: [new EmbedBuilder().setColor(WEBHOOK_COLOR).setDescription(chunks[i]).setTimestamp()] }).catch(() => {});
    }
}

async function cmdServerInfo(ctx) {
    const guild = ctx.guild;
    const owner = await guild.fetchOwner().catch(() => null);
    const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
    const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
    const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size;
    const humans = guild.members.cache.filter(m => !m.user.bot).size;
    const bots = guild.members.cache.filter(m => m.user.bot).size;

    const embed = new EmbedBuilder().setTitle("ℹ️ " + guild.name).setThumbnail(guild.iconURL({ size: 256 }) || null).setColor(WEBHOOK_COLOR)
        .addFields(
            { name: "Owner", value: owner ? owner.toString() : "Unknown", inline: true },
            { name: "ID", value: "`" + guild.id + "`", inline: true },
            { name: "Created", value: "<t:" + ((guild.createdTimestamp / 1000) | 0) + ":R>", inline: true },
            { name: "Members", value: String(guild.memberCount), inline: true },
            { name: "Humans / Bots (cached)", value: humans + " / " + bots, inline: true },
            { name: "Roles", value: String(guild.roles.cache.size - 1), inline: true },
            { name: "Channels", value: textChannels + " text • " + voiceChannels + " voice • " + categories + " cat", inline: true },
            { name: "Boost Tier", value: "Tier " + guild.premiumTier, inline: true },
            { name: "Boosts", value: String(guild.premiumSubscriptionCount || 0), inline: true }
        ).setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined }).setTimestamp();
    if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));
    await ctx.reply({ embeds: [embed] });
}

async function cmdAfk(ctx, isSlash, reason) {
    const guild = ctx.guild;
    const user = isSlash ? ctx.user : ctx.author;
    const member = ctx.member;
    const gc = getGuildConfig(guild.id);
    const trimmed = (reason || "AFK").slice(0, 200);
    const already = gc.afk[user.id];
    gc.afk[user.id] = { reason: trimmed, since: already ? already.since : Date.now() };
    saveConfig();
    await ctx.reply({ embeds: [new EmbedBuilder().setDescription("💤 **" + member.displayName + "** is now AFK: **" + trimmed + "**").setColor(0xFEE75C).setTimestamp()] });
}

async function cmdAv(ctx, targetUser) {
    const user = targetUser || ctx.user || ctx.author;
    await ctx.reply({ embeds: [new EmbedBuilder().setTitle(user.username + "'s Avatar").setColor(WEBHOOK_COLOR)
        .setImage(user.displayAvatarURL({ size: 1024, extension: "png" }))
        .addFields({ name: "Username", value: user.tag, inline: true }, { name: "ID", value: "`" + user.id + "`", inline: true }).setTimestamp()] });
}

async function cmdSlowmode(ctx, seconds) {
    const ch = ctx.channel;
    if (!ch?.isTextBased?.()) return ctx.reply({ embeds: [errorEmbed("Not a text channel.")] });
    try {
        await ch.setRateLimitPerUser(seconds, "Slowmode");
        await ctx.reply({ embeds: [new EmbedBuilder().setDescription(seconds > 0 ? "🐢 Slowmode set to **" + seconds + "s**." : "🐢 Slowmode disabled.").setColor(0x57F287).setTimestamp()] });
        broadcast(ctx.guild, logEmbed("Slowmode Changed", "**Channel:** " + ch + "\n**Seconds:** " + seconds + "\n**By:** " + (ctx.user || ctx.author).tag, WEBHOOK_COLOR), ["log"]).catch(() => {});
    } catch { await ctx.reply({ embeds: [errorEmbed("Failed to set slowmode.")] }); }
}

async function cmdLock(ctx, lock, reason) {
    const guild = ctx.guild;
    try {
        await ctx.channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: lock ? false : null }, { reason: reason || (lock ? "Locked" : "Unlocked") });
        await ctx.reply({ embeds: [new EmbedBuilder().setDescription((lock ? "🔒 **Channel locked.**" : "🔓 **Channel unlocked.**") + (reason ? "\n**Reason:** " + reason : "")).setColor(lock ? 0xED4245 : 0x57F287).setTimestamp()] });
        broadcast(guild, logEmbed(lock ? "Channel Locked" : "Channel Unlocked", "**Channel:** " + ctx.channel + "\n**By:** " + (ctx.user || ctx.author).tag + (reason ? "\n**Reason:** " + reason : ""), lock ? 0xED4245 : 0x57F287), ["log"]).catch(() => {});
    } catch { await ctx.reply({ embeds: [errorEmbed("Failed.")] }); }
}

async function cmdPurge(ctx, isSlash, amount, filterUser) {
    const ch = ctx.channel;
    if (!ch?.isTextBased?.()) return ctx.reply({ embeds: [errorEmbed("Not a text channel.")] });
    const n = Math.min(Math.max(amount, 1), 100);
    try {
        const fetched = await ch.messages.fetch({ limit: n });
        const filtered = filterUser ? fetched.filter(m => m.author.id === filterUser.id) : fetched;
        const deleted = await ch.bulkDelete(filtered, true);
        const embed = successEmbed("Deleted **" + deleted.size + "** message" + (deleted.size === 1 ? "" : "s") + ".");
        if (isSlash) await ctx.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        else {
            const m = await ctx.reply({ embeds: [embed] });
            setTimeout(() => m.delete().catch(() => {}), 5000);
        }
        broadcast(ctx.guild, logEmbed("Messages Purged", "**Channel:** " + ch + "\n**Count:** " + deleted.size + "\n**By:** " + (ctx.user || ctx.author).tag + (filterUser ? "\n**Filter:** " + filterUser.tag : ""), 0xFEE75C), ["log"]).catch(() => {});
    } catch { await ctx.reply({ embeds: [errorEmbed("Failed to purge.")] }); }
}

async function cmdDeafen(ctx, targetMember, deafen, reason) {
    if (!targetMember) return ctx.reply({ embeds: [errorEmbed("Member not found.")] });
    const executorMember = ctx.member || { guild: ctx.guild, id: ctx.user?.id || ctx.author?.id, roles: { highest: { position: 999 } }, user: ctx.user || ctx.author };
    if (!canModerate(executorMember, targetMember)) return ctx.reply({ embeds: [errorEmbed("Role hierarchy blocks this.")] });
    try {
        await targetMember.voice.setDeaf(deafen, reason || (deafen ? "Server-deafened" : "Undeafened"));
        await ctx.reply({ embeds: [new EmbedBuilder().setDescription((deafen ? "🔇 Deafened " : "🔊 Undeafened ") + targetMember + ".").setColor(0x57F287).setTimestamp()] });
    } catch { await ctx.reply({ embeds: [errorEmbed("Failed (user in voice?).")] }); }
}

async function cmdMoveAll(ctx, targetChannel) {
    const voiceState = ctx.member?.voice;
    if (!voiceState?.channel) return ctx.reply({ embeds: [errorEmbed("You must be in a voice channel.")] });
    if (targetChannel.type !== ChannelType.GuildVoice && targetChannel.type !== ChannelType.GuildStageVoice) return ctx.reply({ embeds: [errorEmbed("Target must be a voice channel.")] });
    const source = voiceState.channel;
    const members = [...source.members.values()];
    let moved = 0;
    for (const m of members) { try { await m.voice.setChannel(targetChannel); moved++; } catch {} }
    await ctx.reply({ embeds: [new EmbedBuilder().setDescription("🚚 Moved **" + moved + "** member" + (moved === 1 ? "" : "s") + " from " + source + " to " + targetChannel + ".").setColor(0x57F287).setTimestamp()] });
}

async function cmdAnnounce(ctx, channel, message) {
    const target = channel || ctx.channel;
    if (!target.isTextBased?.()) return ctx.reply({ embeds: [errorEmbed("Invalid channel.")] });
    const author = ctx.user || ctx.author;
    const embed = new EmbedBuilder().setTitle("📣 Announcement").setDescription(message).setColor(WEBHOOK_COLOR).setThumbnail(ctx.guild.iconURL({ size: 256 }) || null).setFooter({ text: "By " + author.tag, iconURL: author.displayAvatarURL() }).setTimestamp();
    try {
        await target.send({ embeds: [embed] });
        await ctx.reply({ embeds: [successEmbed("Announcement sent.")], flags: MessageFlags.Ephemeral });
    } catch { await ctx.reply({ embeds: [errorEmbed("Failed to send.")] }); }
}

async function cmdAddRole(ctx, targetMember, role, remove) {
    if (!targetMember) return ctx.reply({ embeds: [errorEmbed("Member not found.")] });
    const executorMember = ctx.member || { guild: ctx.guild, id: ctx.user?.id || ctx.author?.id, roles: { highest: { position: 999 } }, user: ctx.user || ctx.author };
    if (!canModerate(executorMember, targetMember)) return ctx.reply({ embeds: [errorEmbed("Role hierarchy blocks this.")] });
    if (!canManageRole(executorMember, role)) return ctx.reply({ embeds: [errorEmbed("Cannot manage that role (hierarchy).")] });
    try {
        if (remove) await targetMember.roles.remove(role);
        else await targetMember.roles.add(role);
        await ctx.reply({ embeds: [new EmbedBuilder().setDescription((remove ? "➖ Removed " : "➕ Added ") + role + (remove ? " from " : " to ") + targetMember + ".").setColor(0x57F287).setTimestamp()] });
        broadcast(ctx.guild, logEmbed(remove ? "Role Removed" : "Role Added", "**User:** " + targetMember + "\n**Role:** " + role + "\n**By:** " + (ctx.user || ctx.author).tag, WEBHOOK_COLOR), ["log"]).catch(() => {});
    } catch { await ctx.reply({ embeds: [errorEmbed("Failed (check role hierarchy?).")] }); }
}

// ============ NICKNAME ============

async function cmdSelfNick(ctx, isSlash, newName) {
    const member = ctx.member;
    if (!member) return ctx.reply({ embeds: [errorEmbed("Could not resolve your member data.")] });

    const oldName = member.nickname || member.user.username;
    const cleanNew = newName ? newName.slice(0, 32) : null;

    try {
        await member.setNickname(cleanNew, "Self-nickname change");
    } catch (e) {
        console.error("self nick err:", e);
        return ctx.reply({ embeds: [errorEmbed("I couldn't change your nickname. (Do I have **Manage Nicknames** and a higher role than yours?)")] });
    }

    const finalName = member.nickname || member.user.username;
    const embed = new EmbedBuilder()
        .setDescription(cleanNew
            ? "✏️ Your nickname was set to **" + finalName + "**."
            : "✏️ Your nickname was reset to **" + finalName + "**.")
        .setColor(0x57F287)
        .setTimestamp();

    await ctx.reply({ embeds: [embed] });

    broadcast(ctx.guild, logEmbed("Nickname Changed",
        "**User:** " + member + " (`" + member.user.tag + "`)\n" +
        "**Old:** " + oldName + "\n" +
        "**New:** " + finalName + "\n" +
        "**By:** " + (isSlash ? ctx.user.tag : ctx.author.tag) + " (self)",
        WEBHOOK_COLOR), ["log"]).catch(() => {});
}

async function cmdNickname(ctx, targetMember, newName) {
    if (!targetMember) return ctx.reply({ embeds: [errorEmbed("Member not found.")] });
    const executorMember = ctx.member || { guild: ctx.guild, id: ctx.user?.id || ctx.author?.id, roles: { highest: { position: 999 } }, user: ctx.user || ctx.author };
    if (!canModerate(executorMember, targetMember)) return ctx.reply({ embeds: [errorEmbed("Role hierarchy blocks this.")] });
    const oldName = targetMember.nickname || targetMember.user.username;
    const cleanNew = newName ? newName.slice(0, 32) : null;
    try {
        await targetMember.setNickname(cleanNew, "Moderator nickname change");
    } catch (e) {
        console.error("nick err:", e);
        return ctx.reply({ embeds: [errorEmbed("I couldn't change that member's nickname. (Check role hierarchy + **Manage Nicknames** permission.)")] });
    }
    const finalName = targetMember.nickname || targetMember.user.username;

    await ctx.reply({ embeds: [new EmbedBuilder()
        .setDescription("✏️ " + (cleanNew
            ? "Set **" + targetMember.user.username + "**'s nickname to **" + finalName + "**."
            : "Reset **" + targetMember.user.username + "**'s nickname."))
        .setColor(0x57F287).setTimestamp()] });

    targetMember.send({ embeds: [new EmbedBuilder()
        .setTitle("✏️ Nickname Changed")
        .setDescription("Your nickname in **" + ctx.guild.name + "** was changed.\n\n**Old:** " + oldName + "\n**New:** " + finalName)
        .setColor(WEBHOOK_COLOR).setTimestamp()] }).catch(() => {});

    broadcast(ctx.guild, logEmbed("Nickname Changed",
        "**User:** " + targetMember + " (`" + targetMember.user.tag + "`)\n" +
        "**Old:** " + oldName + "\n" +
        "**New:** " + finalName + "\n" +
        "**By:** " + (ctx.user ? ctx.user.tag : ctx.author.tag),
        WEBHOOK_COLOR), ["log"]).catch(() => {});
}

async function cmdSnipe(ctx) {
    const sniped = _snipeCache.get(ctx.channel.id);
    if (!sniped) return ctx.reply({ embeds: [infoEmbed("Nothing to snipe.")], flags: MessageFlags.Ephemeral });
    await ctx.reply({ embeds: [new EmbedBuilder().setTitle("👻 Sniped Message").setDescription(sniped.content || "*No text content*").setColor(WEBHOOK_COLOR).setAuthor({ name: sniped.author.tag, iconURL: sniped.author.displayAvatarURL() }).setTimestamp(sniped.at)] });
}

// ==========================================
// TICKET HELPERS
// ==========================================

const TICKET_TYPES = {
    support:  { label: "General Support", slug: "general-support", emoji: "⚙️", categoryKey: "ticketSupportCategoryId",  pingKey: "ticketSupportPingRoleId" },
    highrank: { label: "High Rank",       slug: "high-rank",        emoji: "🛡️", categoryKey: "ticketHighRankCategoryId", pingKey: "ticketHighRankPingRoleId" }
};

function isTicketChannel(guild, channelId) {
    const gc = getGuildConfig(guild.id);
    return gc.tickets[channelId] || null;
}

async function cmdTicketAdd(ctx, isSlash, targetUser) {
    const guild = ctx.guild;
    const channel = ctx.channel;
    const ticket = isTicketChannel(guild, channel.id);
    if (!ticket) return ctx.reply({ embeds: [errorEmbed("This channel is not an active ticket.")] });
    try {
        await channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true, EmbedLinks: true }, { reason: "Added to ticket" });
    } catch (e) { console.error("ticket add err:", e); return ctx.reply({ embeds: [errorEmbed("Could not add that user.")] }); }
    await ctx.reply({ embeds: [new EmbedBuilder().setDescription("➕ Added " + targetUser + " to the ticket.").setColor(0x57F287).setTimestamp()] });
    channel.send({ content: targetUser.toString(), allowedMentions: { users: [targetUser.id] } }).catch(() => {});
    broadcast(guild, logEmbed("Ticket User Added", "**Ticket:** #" + ticket.number + "\n**Added:** " + targetUser.tag + " (`" + targetUser.id + "`)\n**By:** " + (isSlash ? ctx.user.tag : ctx.author.tag), WEBHOOK_COLOR), ["ticket"]).catch(() => {});
}

async function cmdTicketRemove(ctx, isSlash, targetUser) {
    const guild = ctx.guild;
    const channel = ctx.channel;
    const ticket = isTicketChannel(guild, channel.id);
    if (!ticket) return ctx.reply({ embeds: [errorEmbed("This channel is not an active ticket.")] });
    if (targetUser.id === ticket.userId) return ctx.reply({ embeds: [errorEmbed("You cannot remove the ticket opener.")] });
    if (targetUser.id === client.user.id) return ctx.reply({ embeds: [errorEmbed("I can't remove myself.")] });
    try {
        await channel.permissionOverwrites.delete(targetUser.id, "Removed from ticket");
    } catch (e) { console.error("ticket remove err:", e); return ctx.reply({ embeds: [errorEmbed("Could not remove that user.")] }); }
    await ctx.reply({ embeds: [new EmbedBuilder().setDescription("➖ Removed " + targetUser + " from the ticket.").setColor(0xED4245).setTimestamp()] });
    broadcast(guild, logEmbed("Ticket User Removed", "**Ticket:** #" + ticket.number + "\n**Removed:** " + targetUser.tag + " (`" + targetUser.id + "`)\n**By:** " + (isSlash ? ctx.user.tag : ctx.author.tag), 0xED4245), ["ticket"]).catch(() => {});
}

async function cmdTicketRename(ctx, isSlash, newName) {
    const guild = ctx.guild;
    const channel = ctx.channel;
    const ticket = isTicketChannel(guild, channel.id);
    if (!ticket) return ctx.reply({ embeds: [errorEmbed("This channel is not an active ticket.")] });
    const cleanName = newName.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 90);
    try {
        await channel.setName(cleanName, "Renamed by " + (isSlash ? ctx.user.tag : ctx.author.tag));
    } catch (e) { console.error("rename err:", e); return ctx.reply({ embeds: [errorEmbed("Could not rename.")] }); }
    await ctx.reply({ embeds: [new EmbedBuilder().setDescription("✏️ Renamed to **" + cleanName + "**.").setColor(0x57F287).setTimestamp()] });
    broadcast(guild, logEmbed("Ticket Renamed", "**Ticket:** #" + ticket.number + "\n**New name:** " + cleanName + "\n**By:** " + (isSlash ? ctx.user.tag : ctx.author.tag), WEBHOOK_COLOR), ["ticket"]).catch(() => {});
}

async function cmdTicketClaim(ctx, isSlash) {
    const guild = ctx.guild;
    const channel = ctx.channel;
    const ticket = isTicketChannel(guild, channel.id);
    if (!ticket) return ctx.reply({ embeds: [errorEmbed("This channel is not an active ticket.")] });
    const user = isSlash ? ctx.user : ctx.author;
    if (ticket.claimedBy) return ctx.reply({ embeds: [errorEmbed("Already claimed by <@" + ticket.claimedBy + ">.")] });
    ticket.claimedBy = user.id;
    ticket.claimedAt = Date.now();
    saveConfig();
    await ctx.reply({ embeds: [successEmbed("🎯 Ticket claimed by " + user.tag + ".")] });
    broadcast(guild, logEmbed("Ticket Claimed", "**Ticket:** #" + ticket.number + "\n**Claimed by:** " + user.tag, WEBHOOK_COLOR), ["ticket"]).catch(() => {});
}

async function cmdTicketUnclaim(ctx, isSlash) {
    const guild = ctx.guild;
    const channel = ctx.channel;
    const ticket = isTicketChannel(guild, channel.id);
    if (!ticket) return ctx.reply({ embeds: [errorEmbed("This channel is not an active ticket.")] });
    const user = isSlash ? ctx.user : ctx.author;
    if (!ticket.claimedBy) return ctx.reply({ embeds: [errorEmbed("Not claimed.")] });
    if (ticket.claimedBy !== user.id && !getMemberTiers(ctx.member).has("management")) return ctx.reply({ embeds: [errorEmbed("Only the claimer or management can unclaim.")] });
    delete ticket.claimedBy;
    delete ticket.claimedAt;
    saveConfig();
    await ctx.reply({ embeds: [successEmbed("Ticket unclaimed.")] });
    broadcast(guild, logEmbed("Ticket Unclaimed", "**Ticket:** #" + ticket.number + "\n**By:** " + user.tag, WEBHOOK_COLOR), ["ticket"]).catch(() => {});
}

async function handleTicketCreate(interaction, type, prefillReason) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    const cfg = TICKET_TYPES[type];
    if (!cfg) return interaction.reply({ embeds: [errorEmbed("Unknown ticket type.")], flags: MessageFlags.Ephemeral });

    const existing = Object.entries(gc.tickets).find(([, t]) => t.userId === interaction.user.id && t.open);
    if (existing) {
        const ch = guild.channels.cache.get(existing[0]);
        return interaction.reply({ embeds: [errorEmbed(ch ? "You have an open ticket: " + ch : "You already have an open ticket.")], flags: MessageFlags.Ephemeral });
    }

    const categoryId = gc[cfg.categoryKey];
    if (!categoryId) return interaction.reply({ embeds: [errorEmbed("Category not set. Configure in `/setup → Tickets`.")], flags: MessageFlags.Ephemeral });
    const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) return interaction.reply({ embeds: [errorEmbed("Category missing.")], flags: MessageFlags.Ephemeral });

    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const ticketNumber = (gc.ticketCounter || 0) + 1;
    gc.ticketCounter = ticketNumber;
    const cleanUser = (interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "") || "user").slice(0, 15);
    const channelName = ticketNumber + "-" + cfg.slug + "-" + cleanUser;

    const pingRoleId = gc[cfg.pingKey] || null;
    const mgmtRoleIds = gc.managementRoles || [];

    const overwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
    ];
    if (pingRoleId && !overwrites.find(o => o.id === pingRoleId)) overwrites.push({ id: pingRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    for (const rid of mgmtRoleIds) {
        if (!overwrites.find(o => o.id === rid)) overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
    }

    let channel;
    try {
        channel = await guild.channels.create({
            name: channelName, type: ChannelType.GuildText, parent: categoryId,
            permissionOverwrites: overwrites,
            topic: "Ticket #" + ticketNumber + " • " + cfg.label + " • " + interaction.user.tag
        });
    } catch (e) {
        console.error("ticket create:", e);
        return interaction.editReply({ embeds: [errorEmbed("Could not create the ticket channel.")] });
    }

    gc.tickets[channel.id] = { userId: interaction.user.id, type, number: ticketNumber, name: cfg.slug, open: true, createdAt: Date.now() };
    saveConfig();

    const pingParts = [interaction.user.toString()];
    if (pingRoleId) pingParts.push("<@&" + pingRoleId + ">");

    const welcome = new EmbedBuilder()
        .setTitle(cfg.emoji + " " + cfg.label + " — Ticket #" + ticketNumber)
        .setDescription(
            "Hey " + interaction.user.toString() + ", thanks for opening a ticket!\n\n" +
            (prefillReason ? "**Reason:** " + prefillReason + "\n\n" : "") +
            "A staff member will be with you shortly.\n\n" +
            "**Close:** `/close` or the 🔒 button below.\n" +
            "**Claim:** `/ticket claim`"
        )
        .setColor(WEBHOOK_COLOR)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined })
        .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket_claim").setLabel("Claim").setEmoji("🎯").setStyle(ButtonStyle.Success)
    );

    await channel.send({
        content: pingParts.join(" "),
        embeds: [welcome],
        components: [closeRow],
        allowedMentions: { users: [interaction.user.id], roles: pingRoleId ? [pingRoleId] : [] }
    }).catch(e => console.error("ticket send:", e));

    broadcast(guild, logEmbed("Ticket Opened",
        "**Ticket:** #" + ticketNumber + "\n**Type:** " + cfg.label + "\n**User:** " + interaction.user.tag + "\n**Channel:** " + channel,
        WEBHOOK_COLOR), ["ticket", "webhook"]).catch(() => {});

    interaction.user.send({
        embeds: [new EmbedBuilder().setTitle("🎫 Ticket Created")
            .setDescription("Your **" + cfg.label + "** ticket in **" + guild.name + "** has been created: <#" + channel.id + ">")
            .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL({ size: 256 })).setTimestamp()]
    }).catch(() => {});

    return interaction.editReply({ embeds: [successEmbed("Ticket created: <#" + channel.id + ">")] });
}

async function fetchAllMessages(channel, max = 1000) {
    let all = [];
    let lastId = null;
    while (all.length < max) {
        const opts = { limit: 100 };
        if (lastId) opts.before = lastId;
        const batch = await channel.messages.fetch(opts).catch(() => null);
        if (!batch || batch.size === 0) break;
        all.push(...batch.values());
        lastId = batch.last().id;
        if (batch.size < 100) break;
    }
    return all.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

async function doTicketCloseWork(guild, ticketChannel, ticket, executorUser, reason) {
    try {
        const sorted = await fetchAllMessages(ticketChannel, 1000);
        let text = "=== Ticket #" + ticket.number + " Transcript ===\nType: " + ticket.type + "\nUser ID: " + ticket.userId + "\nClosed by: " + executorUser.tag + " (" + executorUser.id + ")\nReason: " + (reason || "No reason provided") + "\nClosed at: " + new Date().toISOString() + "\n======================================\n\n";
        for (const m of sorted) {
            text += "[" + new Date(m.createdTimestamp).toISOString() + "] " + m.author.tag + ": " + (m.content || "<no text>") + "\n";
            if (m.attachments.size) for (const a of m.attachments.values()) text += "   [attachment] " + a.url + "\n";
        }
        const attachment = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: "transcript-" + ticket.number + "-" + ticket.type + ".txt" });
        const tEmbed = new EmbedBuilder().setTitle("Ticket Transcript — #" + ticket.number).setColor(WEBHOOK_COLOR)
            .addFields(
                { name: "Type", value: ticket.type, inline: true },
                { name: "Owner", value: "<@" + ticket.userId + ">", inline: true },
                { name: "Closed By", value: executorUser.tag, inline: true },
                { name: "Reason", value: (reason || "No reason provided").slice(0, 1024), inline: false }
            ).setTimestamp();
        await sendTranscript(guild, attachment, tEmbed);
    } catch (e) { console.error("transcript:", e); }

    ticket.open = false;
    ticket.closedAt = Date.now();
    ticket.closedBy = executorUser.id;
    ticket.closeReason = reason || "No reason provided";
    saveConfig();

    try {
        const opener = await client.users.fetch(ticket.userId).catch(() => null);
        if (opener) {
            opener.send({ embeds: [new EmbedBuilder().setTitle("🎫 Ticket Closed")
                .setDescription("Your ticket **#" + ticket.number + "** in **" + guild.name + "** has been closed.\n\n**Closed by:** " + executorUser.tag + "\n**Reason:** " + (reason || "No reason provided"))
                .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL({ size: 256 })).setTimestamp()] }).catch(() => {});
        }
    } catch {}

    broadcast(guild, logEmbed("Ticket Closed", "**Ticket:** #" + ticket.number + "\n**Type:** " + ticket.type + "\n**Closed By:** " + executorUser.tag + "\n**Reason:** " + (reason || "No reason provided"), 0xED4245), ["ticket", "webhook"]).catch(() => {});

    setTimeout(async () => { try { await ticketChannel.delete("Ticket closed"); } catch {} }, 5000);
}

async function performTicketClose(ctx, isSlash, reason) {
    const guild = ctx.guild;
    const channel = ctx.channel;
    const member = ctx.member;
    const user = isSlash ? ctx.user : ctx.author;
    const gc = getGuildConfig(guild.id);
    const ticket = gc.tickets[channel.id];
    if (!ticket) return ctx.reply({ embeds: [errorEmbed("This channel is not an active ticket.")] });
    const isOwner = user.id === ticket.userId;
    const memberTiers = getMemberTiers(member);
    const isStaffish = memberTiers.size > 0;
    if (!isOwner && !isStaffish) return ctx.reply({ embeds: [errorEmbed("Only the ticket owner or staff can close.")] });

    const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close_confirm_" + channel.id).setLabel("Confirm Close").setEmoji("✅").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId("ticket_close_cancel_" + channel.id).setLabel("Cancel").setEmoji("❌").setStyle(ButtonStyle.Secondary)
    );
    const sent = await ctx.reply({ embeds: [infoEmbed("Are you sure you want to close this ticket?\n**Reason:** " + (reason || "No reason provided"))], components: [row], withResponse: true });
    _pendingCloseConfirmations.set(sent.id, { userId: user.id, channelId: channel.id, guildId: guild.id, reason: reason || "No reason provided", expiresAt: Date.now() + TICKET_CLOSE_CONFIRM_MS });
}

// ==========================================
// INTERACTION HANDLER
// ==========================================

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isButton()) return await handleButton(interaction);
        if (interaction.isModalSubmit()) return await handleModal(interaction);
        if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isUserSelectMenu()) return await handleSelect(interaction);
        if (!interaction.isChatInputCommand()) return;

        const guild = interaction.guild;
        if (!guild) return;
        const gc = getGuildConfig(guild.id);
        const command = interaction.commandName;

        // Custom commands checked first
        if (gc.customCommands[command] && gc.customCommands[command].enabled !== false) {
            return runCustomCommand(guild, command, interaction, true);
        }

        // Permission check
        if (!canRunCommand(interaction.member, command)) {
            const required = getRequiredTiers(guild.id, command);
            return interaction.reply({ embeds: [errorEmbed("You don't have permission.\n**Required:** " + fmtTiers(required))], flags: MessageFlags.Ephemeral });
        }

        if (command === "setup") return interaction.reply({ embeds: [buildSetupEmbed(guild)], components: buildSetupRows(), flags: MessageFlags.Ephemeral });
        if (command === "setprefix") {
            const prefix = interaction.options.getString("prefix");
            if (/\s/.test(prefix)) return interaction.reply({ embeds: [errorEmbed("No spaces.")], flags: MessageFlags.Ephemeral });
            setPrefix(guild.id, prefix);
            broadcast(guild, logEmbed("Prefix Changed", "**New prefix:** `" + prefix + "`\n**By:** " + interaction.user.tag, WEBHOOK_COLOR), ["log"]).catch(() => {});
            return interaction.reply({ embeds: [successEmbed("Prefix: `" + prefix + "`.")] });
        }
        if (command === "setuptickets") {
            await interaction.channel.send({ embeds: [buildTicketPanelEmbed(guild)], components: buildTicketPanelRows() });
            return interaction.reply({ embeds: [successEmbed("Ticket panel posted.")], flags: MessageFlags.Ephemeral });
        }
        if (command === "set-webhook") {
            const url = interaction.options.getString("url");
            if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(url)) return interaction.reply({ embeds: [errorEmbed("Invalid URL.")], flags: MessageFlags.Ephemeral });
            gc.webhookUrl = url; saveConfig();
            broadcast(guild, logEmbed("Webhook Set", "**By:** " + interaction.user.tag, WEBHOOK_COLOR), ["log"]).catch(() => {});
            return interaction.reply({ embeds: [successEmbed("Webhook set.")], flags: MessageFlags.Ephemeral });
        }
        if (command === "remove-webhook") { gc.webhookUrl = null; saveConfig(); return interaction.reply({ embeds: [successEmbed("Removed.")], flags: MessageFlags.Ephemeral }); }

        if (command === "acceptsetup") {
            const sub = interaction.options.getSubcommand();
            if (sub === "add")    { const r = interaction.options.getRole("role"); if (!gc.acceptRoleIds.includes(r.id)) gc.acceptRoleIds.push(r.id); saveConfig(); return interaction.reply({ embeds: [successEmbed(r + " added.")] }); }
            if (sub === "remove") { const r = interaction.options.getRole("role"); gc.acceptRoleIds = gc.acceptRoleIds.filter(id => id !== r.id); saveConfig(); return interaction.reply({ embeds: [successEmbed("Removed.")] }); }
            if (sub === "list")   return interaction.reply({ embeds: [infoEmbed("**Accept Roles:** " + fmtRoleList(gc.acceptRoleIds))], flags: MessageFlags.Ephemeral });
            if (sub === "clear")  { gc.acceptRoleIds = []; saveConfig(); return interaction.reply({ embeds: [successEmbed("Cleared.")] }); }
        }

        if (command === "antinuke") {
            const sub = interaction.options.getSubcommand();
            const an = gc.antinuke;
            if (sub === "status") {
                const watchCount = Object.values(an.watchlist).filter(e => Date.now() < e).length;
                return interaction.reply({ embeds: [new EmbedBuilder().setTitle("🛡️ Anti-Nuke Status").setColor(WEBHOOK_COLOR)
                    .addFields(
                        { name: "Enabled", value: an.enabled ? "✅" : "❌", inline: true },
                        { name: "Threshold", value: String(an.threshold), inline: true },
                        { name: "Window", value: (an.windowMs / 1000) + "s", inline: true },
                        { name: "Whitelist", value: an.whitelist.length ? an.whitelist.map(id => "<@" + id + ">").join(", ") : "None", inline: false },
                        { name: "On Watch", value: String(watchCount), inline: true }
                    )], flags: MessageFlags.Ephemeral });
            }
            if (sub === "enable")          { an.enabled = true; saveConfig();  return interaction.reply({ embeds: [successEmbed("Enabled.")] }); }
            if (sub === "disable")         { an.enabled = false; saveConfig(); return interaction.reply({ embeds: [successEmbed("Disabled.")] }); }
            if (sub === "threshold")       { const n = interaction.options.getInteger("count"); an.threshold = n; saveConfig(); return interaction.reply({ embeds: [successEmbed("Threshold: **" + n + "**.")] }); }
            if (sub === "whitelist-add")   { const u = interaction.options.getUser("user"); if (!an.whitelist.includes(u.id)) an.whitelist.push(u.id); saveConfig(); return interaction.reply({ embeds: [successEmbed(u.tag + " whitelisted.")] }); }
            if (sub === "whitelist-remove"){ const u = interaction.options.getUser("user"); an.whitelist = an.whitelist.filter(id => id !== u.id); saveConfig(); return interaction.reply({ embeds: [successEmbed("Removed.")] }); }
            if (sub === "whitelist-list")  { const list = an.whitelist.length ? an.whitelist.map(id => "<@" + id + ">").join(", ") : "None"; return interaction.reply({ embeds: [infoEmbed("**Whitelisted:** " + list)], flags: MessageFlags.Ephemeral }); }
            if (sub === "watchlist") {
                const now = Date.now();
                const entries = Object.entries(an.watchlist).filter(([, e]) => e > now);
                if (!entries.length) return interaction.reply({ embeds: [infoEmbed("No users on watch.")], flags: MessageFlags.Ephemeral });
                return interaction.reply({ embeds: [infoEmbed("**Watch:**\n" + entries.map(([uid, e]) => "• <@" + uid + "> — <t:" + ((e / 1000) | 0) + ":R>").join("\n"))], flags: MessageFlags.Ephemeral });
            }
            if (sub === "unwatch") { const u = interaction.options.getUser("user"); delete an.watchlist[u.id]; saveConfig(); return interaction.reply({ embeds: [successEmbed("Unwatched.")] }); }
            if (sub === "reset")   { an.counters = {}; saveConfig(); return interaction.reply({ embeds: [successEmbed("Reset.")] }); }
        }

        if (command === "accept") { await interaction.deferReply(); const r = await doAccept(guild, interaction.user, interaction.options.getUser("user"), interaction.options.getString("notes") || null); return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "deny")   { await interaction.deferReply(); const r = await doDeny(guild, interaction.user, interaction.options.getUser("user"), interaction.options.getString("reason"), interaction.options.getString("notes") || null); return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "promote"){ await interaction.deferReply(); const r = await doPromote(guild, interaction.user, interaction.options.getUser("user"), interaction.options.getString("rank"), interaction.options.getString("notes") || null, interaction.options.getRole("role")); return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "demote") { await interaction.deferReply(); const r = await doDemote(guild, interaction.user, interaction.options.getUser("user"), interaction.options.getString("rank"), interaction.options.getString("notes") || null, interaction.options.getRole("role")); return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "infract"){ await interaction.deferReply(); const r = await doInfract(guild, interaction.user, interaction.options.getUser("user"), interaction.options.getString("type"), interaction.options.getString("reason"), interaction.options.getString("notes") || null); return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }

        if (command === "mute")   { await interaction.deferReply(); const t = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null); const r = await doMute(guild, interaction.member, t, interaction.options.getString("duration"), interaction.options.getString("reason") || "No reason provided"); return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "unmute") { await interaction.deferReply(); const t = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null); const r = await doUnmute(guild, interaction.member, t, interaction.options.getString("reason") || "No reason provided"); return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "warn")   { const t = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null); const r = await doWarn(guild, interaction.member, t, interaction.options.getString("reason") || "No reason provided"); return interaction.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "kick")   { await interaction.deferReply(); const t = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null); const r = await doKick(guild, interaction.member, t, interaction.options.getString("reason") || "No reason provided"); return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "ban")    {
            await interaction.deferReply();
            const userOpt = interaction.options.getUser("user");
            const idOpt = interaction.options.getString("userid");
            if (!userOpt && !idOpt) return interaction.editReply({ embeds: [errorEmbed("Provide a user or a user ID.")] });
            let r;
            if (userOpt) {
                const t = await guild.members.fetch(userOpt.id).catch(() => null);
                r = await doBan(guild, interaction.member, t, interaction.options.getString("reason") || "No reason provided");
            } else {
                if (!/^\d{15,25}$/.test(idOpt)) return interaction.editReply({ embeds: [errorEmbed("Invalid user ID.")] });
                r = await doBan(guild, interaction.member, null, interaction.options.getString("reason") || "No reason provided", idOpt);
            }
            return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] });
        }
        if (command === "unban")  { await interaction.deferReply(); const r = await doUnban(guild, interaction.member, interaction.options.getString("userid"), interaction.options.getString("reason") || "No reason provided"); return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }

        if (command === "loguser") { await interaction.deferReply(); const r = await doLogUser(guild, interaction.user, interaction.options.getString("username"), interaction.options.getString("punishment"), interaction.options.getString("reason"), interaction.options.getString("notes") || null); return interaction.editReply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "robloxhistory") { return doRobloxHistory(interaction, true, interaction.options.getString("username")); }

        if (command === "poll") {
            const question = interaction.options.getString("question");
            const options = [];
            for (let i = 1; i <= 10; i++) { const v = interaction.options.getString("option" + i); if (v) options.push(v); }
            const duration = interaction.options.getInteger("duration") || null;
            const pollId = crypto.randomBytes(6).toString("hex");
            const votes = {}; options.forEach((_, i) => votes[i] = []);
            await interaction.reply({ embeds: [buildPollEmbed(question, options, votes, false, duration)], components: buildPollRows(options, pollId, false), withResponse: true });
            const msg = await interaction.fetchReply();
            polls.set(pollId, { question, options, votes, messageId: msg.id, channelId: interaction.channel.id, guildId: guild.id, ended: false, endsAt: duration ? Date.now() + duration * 60000 : null });
            if (duration) setTimeout(() => endPoll(pollId), duration * 60 * 1000).unref?.();
            return;
        }
        if (command === "giveaway") {
            const prize = interaction.options.getString("prize");
            const duration = interaction.options.getInteger("duration");
            const winners = interaction.options.getInteger("winners") || 1;
            const requiredRole = interaction.options.getRole("required_role");
            const targetChannel = interaction.options.getChannel("channel") || interaction.channel;
            const isTextLike = targetChannel && (targetChannel.type === ChannelType.GuildText || targetChannel.type === ChannelType.GuildAnnouncement);
            if (!isTextLike) return interaction.reply({ embeds: [errorEmbed("Channel must be a text or announcement channel.")], flags: MessageFlags.Ephemeral });
            const endsAt = Date.now() + duration * 60 * 1000;
            const giveawayId = crypto.randomBytes(6).toString("hex");
            const giveaway = { prize, winners, requiredRoleId: requiredRole?.id || null, hostId: interaction.user.id, endsAt, entries: [], ended: false, channelId: targetChannel.id, messageId: null };
            const msg = await targetChannel.send({ embeds: [buildGiveawayEmbed(giveaway, false, [])], components: buildGiveawayRows(giveawayId, false) });
            giveaway.messageId = msg.id;
            gc.giveaways[giveawayId] = giveaway;
            saveConfig();
            await interaction.reply({ embeds: [successEmbed("Giveaway started in " + targetChannel + "!")], flags: MessageFlags.Ephemeral });
            setTimeout(() => endGiveaway(giveawayId), duration * 60 * 1000).unref?.();
            return;
        }
        if (command === "giveaway-end") {
            await interaction.deferReply();
            const msgId = interaction.options.getString("message_id");
            const entry = Object.entries(gc.giveaways).find(([, g]) => g.messageId === msgId);
            if (!entry) return interaction.editReply({ embeds: [errorEmbed("Giveaway not found.")] });
            await endGiveaway(entry[0]);
            return interaction.editReply({ embeds: [successEmbed("Giveaway ended.")] });
        }
        if (command === "giveaway-reroll") {
            await interaction.deferReply();
            const msgId = interaction.options.getString("message_id");
            return rerollGiveaway(guild, msgId, interaction);
        }

        if (command === "suggestion-approve" || command === "suggestion-deny") {
            await interaction.deferReply();
            const msgId = interaction.options.getString("message_id");
            const s = gc.suggestions[msgId];
            if (!s) return interaction.editReply({ embeds: [errorEmbed("Suggestion not found.")] });
            s.status = command === "suggestion-approve" ? "approved" : "denied";
            s.reviewedBy = interaction.user.id;
            s.reviewReason = interaction.options.getString("reason") || null;
            saveConfig();
            try {
                const ch = await client.channels.fetch(gc.suggestionChannelId).catch(() => null);
                if (ch) {
                    const msg = await ch.messages.fetch(msgId).catch(() => null);
                    if (msg) {
                        const author = await client.users.fetch(s.authorId).catch(() => null) || { id: s.authorId, toString: () => "<@" + s.authorId + ">" };
                        const embed = buildSuggestionEmbed(s.content, author, s.upvotes.length, s.downvotes.length, s.status, s.reviewReason);
                        await msg.edit({ embeds: [embed], components: [buildVoteRow(msgId, "suggestion")] }).catch(() => {});
                    }
                }
            } catch {}
            return interaction.editReply({ embeds: [successEmbed("Suggestion " + s.status + ".")] });
        }

        if (command === "roles")      return cmdRoles(interaction);
        if (command === "serverinfo") return cmdServerInfo(interaction);
        if (command === "afk")        return cmdAfk(interaction, true, interaction.options.getString("reason"));
        if (command === "av")         return cmdAv(interaction, interaction.options.getUser("user"));
        if (command === "botinfo" || command === "stats") return cmdBotInfo(interaction);
        if (command === "ping")       return cmdPing(interaction, true);
        if (command === "uptime")     return cmdUptime(interaction);
        if (command === "invite")     return cmdInvite(interaction);
        if (command === "membercount") return cmdMemberCount(interaction);
        if (command === "userinfo")   return cmdUserInfo(interaction, true, interaction.options.getUser("user"));
        if (command === "roleinfo")   return cmdRoleInfo(interaction, interaction.options.getRole("role"));
        if (command === "banner")     return cmdBanner(interaction, interaction.options.getUser("user"));
        if (command === "history")    return cmdHistory(interaction, interaction.options.getUser("user"));

        if (command === "slowmode")   return cmdSlowmode(interaction, interaction.options.getInteger("seconds"));
        if (command === "lock")       return cmdLock(interaction, true, interaction.options.getString("reason"));
        if (command === "unlock")     return cmdLock(interaction, false, interaction.options.getString("reason"));
        if (command === "purge")      return cmdPurge(interaction, true, interaction.options.getInteger("amount"), interaction.options.getUser("user"));
        if (command === "deafen")     return cmdDeafen(interaction, await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null), true, interaction.options.getString("reason"));
        if (command === "undeafen")   return cmdDeafen(interaction, await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null), false, interaction.options.getString("reason"));
        if (command === "moveall")    return cmdMoveAll(interaction, interaction.options.getChannel("channel"));
        if (command === "announce")   return cmdAnnounce(interaction, interaction.options.getChannel("channel"), interaction.options.getString("message"));
        if (command === "addrole")    return cmdAddRole(interaction, await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null), interaction.options.getRole("role"), false);
        if (command === "removerole") return cmdAddRole(interaction, await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null), interaction.options.getRole("role"), true);

        if (command === "nick") {
            const newName = interaction.options.getString("name") || null;
            return cmdSelfNick(interaction, true, newName);
        }
        if (command === "nickname") {
            const newName = interaction.options.getString("name") || null;
            const targetMember = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
            return cmdNickname(interaction, targetMember, newName);
        }
        if (command === "snipe")      return cmdSnipe(interaction);

        if (command === "close" || command === "closeticket" || command === "ticketclose") {
            return performTicketClose(interaction, true, interaction.options.getString("reason") || null);
        }
        if (command === "ticket") {
            const sub = interaction.options.getSubcommand();
            if (sub === "add")    return cmdTicketAdd(interaction, true, interaction.options.getUser("user"));
            if (sub === "remove") return cmdTicketRemove(interaction, true, interaction.options.getUser("user"));
            if (sub === "rename") return cmdTicketRename(interaction, true, interaction.options.getString("name"));
            if (sub === "claim")  return cmdTicketClaim(interaction, true);
            if (sub === "unclaim") return cmdTicketUnclaim(interaction, true);
        }

        if (command === "suggest") {
            if (!gc.suggestionChannelId) return interaction.reply({ embeds: [errorEmbed("Suggestions channel not set.")], flags: MessageFlags.Ephemeral });
            const suggestion = interaction.options.getString("suggestion");
            const ch = guild.channels.cache.get(gc.suggestionChannelId);
            if (!ch) return interaction.reply({ embeds: [errorEmbed("Not found.")], flags: MessageFlags.Ephemeral });
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const sent = await ch.send({ embeds: [buildSuggestionEmbed(suggestion, interaction.user, 0, 0, "pending", null)], components: [buildVoteRow("pending", "suggestion")] });
            await sent.edit({ embeds: [buildSuggestionEmbed(suggestion, interaction.user, 0, 0, "pending", null)], components: [buildVoteRow(sent.id, "suggestion")] });
            gc.suggestions[sent.id] = { authorId: interaction.user.id, content: suggestion, upvotes: [], downvotes: [], createdAt: Date.now(), status: "pending" };
            saveConfig();
            return interaction.editReply({ embeds: [successEmbed("Submitted!")] });
        }
        if (command === "staff-feedback") {
            if (!gc.staffFeedbackChannelId) return interaction.reply({ embeds: [errorEmbed("Staff feedback channel not set.")], flags: MessageFlags.Ephemeral });
            const staffMember = interaction.options.getUser("staff");
            const feedback = interaction.options.getString("feedback");
            const ch = guild.channels.cache.get(gc.staffFeedbackChannelId);
            if (!ch) return interaction.reply({ embeds: [errorEmbed("Not found.")], flags: MessageFlags.Ephemeral });
            await interaction.deferReply({ flags: MessageFlags.Ephemeral });
            const sent = await ch.send({ embeds: [buildStaffFeedbackEmbed(staffMember, feedback, interaction.user, 0, 0)], components: [buildVoteRow("pending", "feedback")] });
            await sent.edit({ embeds: [buildStaffFeedbackEmbed(staffMember, feedback, interaction.user, 0, 0)], components: [buildVoteRow(sent.id, "feedback")] });
            gc.staffFeedback[sent.id] = { authorId: interaction.user.id, staffId: staffMember.id, content: feedback, upvotes: [], downvotes: [], createdAt: Date.now() };
            saveConfig();
            return interaction.editReply({ embeds: [successEmbed("Submitted!")] });
        }

        if (command === "help") {
            const prefix = getPrefix(guild.id);
            const ccNames = Object.keys(gc.customCommands || {});
            const member = interaction.member;
            const visible = [];
            const catMap = [
                { name: "🛠️ Setup", cmds: ["setup", "setprefix", "setuptickets", "set-webhook", "remove-webhook", "acceptsetup", "antinuke"] },
                { name: "👑 HR", cmds: ["accept", "deny", "promote", "demote", "infract"] },
                { name: "🔨 Moderation", cmds: ["mute", "unmute", "warn", "kick", "ban", "unban", "loguser", "robloxhistory"] },
                { name: "🧹 Channel", cmds: ["slowmode", "lock", "unlock", "purge", "announce"] },
                { name: "🔊 Voice", cmds: ["deafen", "undeafen", "moveall"] },
                { name: "🎭 Roles/Nick", cmds: ["addrole", "removerole", "nickname", "nick"] },
                { name: "🎫 Tickets", cmds: ["close", "closeticket", "ticketclose", "ticket"] },
                { name: "🎉 Events", cmds: ["poll", "giveaway", "giveaway-end", "giveaway-reroll", "suggestion-approve", "suggestion-deny"] },
                { name: "🔧 Info", cmds: ["help", "botinfo", "stats", "ping", "uptime", "invite", "membercount", "userinfo", "roleinfo", "banner", "history", "snipe", "roles", "serverinfo", "av", "afk"] },
                { name: "🌐 Public", cmds: ["suggest", "staff-feedback"] }
            ];
            for (const cat of catMap) {
                const allowed = cat.cmds.filter(c => canRunCommand(member, c));
                if (allowed.length) visible.push({ name: cat.name, value: allowed.map(c => "`/" + c + "`").join(" ") });
            }
            if (ccNames.length) visible.push({ name: "🛠️ Custom Commands", value: ccNames.map(n => "`" + prefix + n + "`").join(", ") });
            visible.push({ name: "💬 Prefix", value: "All commands work with `" + prefix + "`" });
            const embed = new EmbedBuilder().setTitle(guild.name + " — Commands " + BOT_VERSION)
                .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL())
                .addFields(visible);
            return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
        }

    } catch (error) {
        console.error("interaction:", error);
        try {
            if (interaction.replied || interaction.deferred) await interaction.followUp({ embeds: [errorEmbed("An error occurred.")], flags: MessageFlags.Ephemeral });
            else await interaction.reply({ embeds: [errorEmbed("An error occurred.")], flags: MessageFlags.Ephemeral });
        } catch {}
    }
});

// ==========================================
// BUTTON HANDLER
// ==========================================

async function handleButton(interaction) {
    const id = interaction.customId;
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);

    if (id.startsWith("poll_vote_")) {
        const parts = id.split("_");
        const pollId = parts[2], optIdx = parseInt(parts[3], 10);
        const p = polls.get(pollId);
        if (!p || p.ended) return interaction.reply({ embeds: [errorEmbed("Poll ended.")], flags: MessageFlags.Ephemeral });
        for (const k in p.votes) p.votes[k] = p.votes[k].filter(u => u !== interaction.user.id);
        if (!p.votes[optIdx]) p.votes[optIdx] = [];
        p.votes[optIdx].push(interaction.user.id);
        await interaction.update({ embeds: [buildPollEmbed(p.question, p.options, p.votes, false, null)], components: buildPollRows(p.options, pollId, false) }).catch(() => {});
        return;
    }

    if (id.startsWith("giveaway_join_")) {
        const giveawayId = id.slice("giveaway_join_".length);
        const g = gc.giveaways[giveawayId];
        if (!g || g.ended) return interaction.reply({ embeds: [errorEmbed("Giveaway ended.")], flags: MessageFlags.Ephemeral });
        if (g.requiredRoleId && !interaction.member.roles.cache.has(g.requiredRoleId)) return interaction.reply({ embeds: [errorEmbed("You need <@&" + g.requiredRoleId + "> to enter.")], flags: MessageFlags.Ephemeral });
        if (g.entries.includes(interaction.user.id)) { g.entries = g.entries.filter(u => u !== interaction.user.id); saveConfig(); await interaction.reply({ embeds: [infoEmbed("You left the giveaway.")], flags: MessageFlags.Ephemeral }); }
        else { g.entries.push(interaction.user.id); saveConfig(); await interaction.reply({ embeds: [successEmbed("You entered the giveaway! 🎉")], flags: MessageFlags.Ephemeral }); }
        try {
            const ch = await client.channels.fetch(g.channelId).catch(() => null);
            if (ch) { const msg = await ch.messages.fetch(g.messageId).catch(() => null); if (msg) await msg.edit({ embeds: [buildGiveawayEmbed(g, false, [])], components: buildGiveawayRows(giveawayId, false) }).catch(() => {}); }
        } catch {}
        return;
    }

    if (id.startsWith("ticket_close_confirm_") || id.startsWith("ticket_close_cancel_")) {
        const isConfirm = id.startsWith("ticket_close_confirm_");
        const ticketChannelId = id.slice(isConfirm ? "ticket_close_confirm_".length : "ticket_close_cancel_".length);
        const pending = _pendingCloseConfirmations.get(interaction.message.id);
        if (!pending) return interaction.reply({ embeds: [errorEmbed("This confirmation has expired.")], flags: MessageFlags.Ephemeral });
        if (Date.now() > pending.expiresAt) {
            _pendingCloseConfirmations.delete(interaction.message.id);
            return interaction.reply({ embeds: [errorEmbed("This confirmation has expired.")], flags: MessageFlags.Ephemeral });
        }
        if (pending.userId !== interaction.user.id) return interaction.reply({ embeds: [errorEmbed("Only the person who initiated this can confirm.")], flags: MessageFlags.Ephemeral });
        _pendingCloseConfirmations.delete(interaction.message.id);
        if (!isConfirm) { await interaction.update({ embeds: [infoEmbed("❌ Ticket close cancelled.")], components: [] }).catch(() => {}); return; }
        await interaction.update({ embeds: [infoEmbed("🔒 Closing ticket...")], components: [] }).catch(() => {});
        const ticketChannel = await client.channels.fetch(ticketChannelId).catch(() => null);
        if (!ticketChannel) return;
        const ticket = gc.tickets[ticketChannelId];
        if (!ticket || !ticket.open) return interaction.followUp({ embeds: [errorEmbed("Already closed.")], flags: MessageFlags.Ephemeral }).catch(() => {});
        await doTicketCloseWork(guild, ticketChannel, ticket, interaction.user, pending.reason);
        return;
    }

    if (id === "ticket_claim") {
        const ticket = gc.tickets[interaction.channel.id];
        if (!ticket) return interaction.reply({ embeds: [errorEmbed("Not a ticket.")], flags: MessageFlags.Ephemeral });
        if (ticket.claimedBy) return interaction.reply({ embeds: [errorEmbed("Already claimed by <@" + ticket.claimedBy + ">.")], flags: MessageFlags.Ephemeral });
        ticket.claimedBy = interaction.user.id;
        ticket.claimedAt = Date.now();
        saveConfig();
        await interaction.reply({ embeds: [successEmbed("🎯 Ticket claimed by " + interaction.user.tag + ".")] });
        broadcast(guild, logEmbed("Ticket Claimed", "**Ticket:** #" + ticket.number + "\n**Claimed by:** " + interaction.user.tag, WEBHOOK_COLOR), ["ticket"]).catch(() => {});
        return;
    }

    if (id === "setup_back")         return updateSetupMessage(interaction, "main");
    if (id === "setup_channels")     return updateSetupMessage(interaction, "channels");
    if (id === "setup_roles")        return updateSetupMessage(interaction, "roles");
    if (id === "setup_tickets")      return updateSetupMessage(interaction, "tickets");
    if (id === "setup_dm_templates") return updateSetupMessage(interaction, "templates");
    if (id === "setup_antinuke")     return updateSetupMessage(interaction, "antinuke");
    if (id === "setup_automod")      return updateSetupMessage(interaction, "automod");
    if (id === "setup_general")      return updateSetupMessage(interaction, "general");
    if (id === "setup_perms")        return showPermsOverview(interaction);
    if (id === "setup_customcommands") return updateSetupMessage(interaction, "customcommands");

    if (id === "setup_cc_add") {
        const modal = new ModalBuilder().setCustomId("modal_cc_add").setTitle("Add Custom Command");
        modal.addComponents(
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("name").setLabel("Command name (no spaces/prefix)").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(32).setPlaceholder("e.g. rules")),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("response").setLabel("Response text").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000)),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("type").setLabel("Type: 'text' or 'embed'").setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(5).setValue("text")),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("color").setLabel("Embed color (hex, only for embed)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(7).setPlaceholder("#2563EB")),
            new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("deletetrigger").setLabel("Delete trigger message? (yes/no)").setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(3).setValue("no"))
        );
        return interaction.showModal(modal);
    }

    if (id === "setup_cc_list") {
        const cc = gc.customCommands || {};
        const names = Object.keys(cc);
        if (!names.length) return interaction.reply({ embeds: [infoEmbed("No custom commands yet.")], flags: MessageFlags.Ephemeral });
        const embed = new EmbedBuilder().setTitle("🛠️ Custom Commands (" + names.length + ")").setColor(WEBHOOK_COLOR).setTimestamp()
            .setDescription(names.map(n => {
                const c = cc[n];
                const preview = c.response.length > 80 ? c.response.slice(0, 80) + "…" : c.response;
                return "**`" + gc.prefix + n + "`** • *" + (c.type || "text") + "* • " + (c.deleteTrigger ? "🗑️ delete trigger" : "no delete") + "\n> " + preview.replace(/\n/g, " ");
            }).join("\n\n"));
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }

    if (id === "setup_cc_clear") {
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_cc_clear_confirm").setLabel("Yes, delete all").setEmoji("🗑️").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_customcommands").setLabel("Cancel").setEmoji("❌").setStyle(ButtonStyle.Secondary)
        );
        return interaction.update({ embeds: [infoEmbed("⚠️ Are you sure you want to delete **all custom commands**?")], components: [row] });
    }
    if (id === "setup_cc_clear_confirm") {
        const names = Object.keys(gc.customCommands);
        for (const n of names) await deleteCustomCommandSlash(guild, n);
        gc.customCommands = {};
        saveConfig();
        return updateSetupMessage(interaction, "customcommands");
    }

    if (id === "setup_cc_delete_select") {
        const cc = gc.customCommands || {};
        const names = Object.keys(cc);
        if (!names.length) return interaction.reply({ embeds: [infoEmbed("No custom commands to delete.")], flags: MessageFlags.Ephemeral });
        const opts = names.slice(0, 25).map(n => ({ label: gc.prefix + n, value: n, description: (cc[n].response || "").slice(0, 90) || "—" }));
        return interaction.update({
            embeds: [infoEmbed("Select a custom command to **delete**:")],
            components: [new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId("select_cc_delete").setPlaceholder("Select command to delete").addOptions(opts)
            )]
        });
    }

    if (id === "setup_cc_edit_select") {
        const cc = gc.customCommands || {};
        const names = Object.keys(cc);
        if (!names.length) return interaction.reply({ embeds: [infoEmbed("No custom commands to edit.")], flags: MessageFlags.Ephemeral });
        const opts = names.slice(0, 25).map(n => ({ label: gc.prefix + n, value: n, description: (cc[n].response || "").slice(0, 90) || "—" }));
        return interaction.update({
            embeds: [infoEmbed("Select a custom command to **edit**:")],
            components: [new ActionRowBuilder().addComponents(
                new StringSelectMenuBuilder().setCustomId("select_cc_edit").setPlaceholder("Select command to edit").addOptions(opts)
            )]
        });
    }

    if (id === "setup_am_swear_toggle") { gc.automod.extremeSweatEnabled = !gc.automod.extremeSweatEnabled; saveConfig(); return updateSetupMessage(interaction, "automod"); }
    if (id === "setup_am_swear_edit") {
        const modal = new ModalBuilder().setCustomId("modal_am_swear_list").setTitle("Extreme Swear List");
        const input = new TextInputBuilder().setCustomId("list").setLabel("Comma-separated list").setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000);
        input.setValue(gc.automod.extremeSweatList.join(", ").slice(0, 2000));
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }
    if (id === "setup_am_ghost_toggle") { gc.automod.ghostPingEnabled = !gc.automod.ghostPingEnabled; saveConfig(); return updateSetupMessage(interaction, "automod"); }
    if (id === "setup_am_link_toggle") { gc.automod.linkFilterEnabled = !gc.automod.linkFilterEnabled; saveConfig(); return updateSetupMessage(interaction, "automod"); }
    if (id === "setup_am_link_wl") return interaction.update({ embeds: [infoEmbed("Choose channels to whitelist:")], components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("select_am_link_wl").setPlaceholder("Pick channels").setMaxValues(10).setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement]))] });
    if (id === "setup_am_link_viewwl") { const list = gc.automod.linkWhitelistChannelIds.length ? gc.automod.linkWhitelistChannelIds.map(c => "<#" + c + ">").join(", ") : "None"; return interaction.reply({ embeds: [infoEmbed("**Link Whitelist:** " + list)], flags: MessageFlags.Ephemeral }); }
    if (id === "setup_am_ignored") {
        const list = gc.automod.ignoredChannelIds.length ? gc.automod.ignoredChannelIds.map(c => "<#" + c + ">").join(", ") : "None";
        return interaction.reply({ embeds: [infoEmbed("**Ignored Channels:** " + list)], flags: MessageFlags.Ephemeral });
    }

    if (id.startsWith("setup_perms_group_")) {
        const groupKey = id.slice(18);
        const group = PERM_GROUPS[groupKey];
        if (!group) return;
        const lines = group.commands.map(c => "`/" + c + "` → " + fmtTiers(getRequiredTiers(guild.id, c)));
        return interaction.update({ embeds: [new EmbedBuilder().setTitle("🔐 " + group.name).setDescription("**Current:**\n" + lines.join("\n")).setColor(WEBHOOK_COLOR).setTimestamp()], components: buildPermsGroupRows(groupKey) });
    }
    if (id.startsWith("setup_perm_edit_")) {
        const cmd = id.slice("setup_perm_edit_".length);
        const tiers = getRequiredTiers(guild.id, cmd);
        return interaction.update({ embeds: [new EmbedBuilder().setTitle("🔐 Edit `/" + cmd + "`").setDescription("**Current:** " + fmtTiers(tiers)).setColor(WEBHOOK_COLOR).setTimestamp()], components: permToggleRows(cmd, tiers) });
    }
    if (id.startsWith("setup_perm_toggle_")) {
        const rest = id.slice("setup_perm_toggle_".length);
        const idx = rest.lastIndexOf("_");
        const cmd = rest.slice(0, idx);
        const tierKey = rest.slice(idx + 1);
        if (!gc.commandPerms[cmd]) gc.commandPerms[cmd] = [...(DEFAULT_COMMAND_PERMS[cmd] || ["management"])];
        const cur = gc.commandPerms[cmd];
        let next;
        if (tierKey === "everyone") {
            next = cur.includes("everyone") ? cur.filter(t => t !== "everyone") : ["everyone"];
        } else {
            next = cur.includes(tierKey) ? cur.filter(t => t !== tierKey) : [...cur.filter(t => t !== "everyone"), tierKey];
            if (next.length === 0) delete gc.commandPerms[cmd];
        }
        if (next && next.length) gc.commandPerms[cmd] = next; else delete gc.commandPerms[cmd];
        saveConfig();
        const newTiers = getRequiredTiers(guild.id, cmd);
        return interaction.update({ embeds: [new EmbedBuilder().setTitle("🔐 Edit `/" + cmd + "`").setDescription("**Current:** " + fmtTiers(newTiers)).setColor(WEBHOOK_COLOR).setTimestamp()], components: permToggleRows(cmd, newTiers) });
    }
    if (id.startsWith("setup_perm_reset_")) {
        const cmd = id.slice("setup_perm_reset_".length);
        delete gc.commandPerms[cmd];
        saveConfig();
        const tiers = getRequiredTiers(guild.id, cmd);
        return interaction.update({ embeds: [new EmbedBuilder().setTitle("🔐 Edit `/" + cmd + "`").setDescription("**Reset to default.** Current: " + fmtTiers(tiers)).setColor(WEBHOOK_COLOR).setTimestamp()], components: permToggleRows(cmd, tiers) });
    }
    if (id === "setup_perms_reset") { gc.commandPerms = {}; saveConfig(); return showPermsOverview(interaction); }

    if (id === "setup_prefix") {
        const modal = new ModalBuilder().setCustomId("modal_prefix").setTitle("Set Prefix");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("prefix").setLabel("New prefix (max 5 chars)").setStyle(TextInputStyle.Short).setMaxLength(5).setRequired(true)));
        return interaction.showModal(modal);
    }
    if (id === "setup_webhook") {
        const modal = new ModalBuilder().setCustomId("modal_webhook").setTitle("Set Webhook URL");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("url").setLabel("Discord webhook URL").setStyle(TextInputStyle.Short).setRequired(true)));
        return interaction.showModal(modal);
    }

    const channelMap = {
        setup_ch_log: { key: "logChannelId", name: "Main Log" },
        setup_ch_stafflog: { key: "staffLogChannelId", name: "Staff Log" },
        setup_ch_hrlog: { key: "hrLogChannelId", name: "HR Log" },
        setup_ch_ticketlog: { key: "ticketLogChannelId", name: "Ticket Log" },
        setup_ch_transcript: { key: "transcriptChannelId", name: "Transcripts" },
        setup_ch_welcome: { key: "welcomeChannelId", name: "Welcome" },
        setup_ch_suggestions: { key: "suggestionChannelId", name: "Suggestions" },
        setup_ch_stafffb: { key: "staffFeedbackChannelId", name: "Staff Feedback" }
    };
    if (channelMap[id]) {
        const cfg = channelMap[id];
        return interaction.update({ embeds: [infoEmbed("Choose a channel for **" + cfg.name + "**:")], components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("select_channel_" + cfg.key).setPlaceholder("Pick a channel").setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement]))] });
    }
    const roleMap = {
        setup_role_staff: { key: "staffRoles", name: "Staff", single: false },
        setup_role_admin: { key: "adminRoles", name: "Admin", single: false },
        setup_role_highrank: { key: "highRankRoles", name: "High Rank", single: false },
        setup_role_management: { key: "managementRoles", name: "Management", single: false },
        setup_role_exempt: { key: "exemptRoles", name: "Exempt", single: false },
        setup_role_accept: { key: "acceptRoleIds", name: "Accept", single: false },
        setup_role_hrping: { key: "hrPingRoleId", name: "HR Ping Role", single: true }
    };
    if (roleMap[id]) {
        const cfg = roleMap[id];
        return interaction.update({ embeds: [infoEmbed("Choose roles for **" + cfg.name + "**:")], components: [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId("select_role_" + cfg.key).setPlaceholder("Pick roles").setMaxValues(cfg.single ? 1 : 10))] });
    }

    if (id === "setup_clear_staff")      { gc.staffRoles = []; invalidateTierCache(guild.id); saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_admin")      { gc.adminRoles = []; invalidateTierCache(guild.id); saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_highrank")   { gc.highRankRoles = []; invalidateTierCache(guild.id); saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_management") { gc.managementRoles = []; invalidateTierCache(guild.id); saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_exempt")     { gc.exemptRoles = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_accept")     { gc.acceptRoleIds = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }

    if (id === "setup_ticket_support_cat")  return interaction.update({ embeds: [infoEmbed("Choose the **Support Tickets Category**:")], components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("select_ticketcat_support").setPlaceholder("Pick a category").setChannelTypes([ChannelType.GuildCategory]))] });
    if (id === "setup_ticket_high_cat")     return interaction.update({ embeds: [infoEmbed("Choose the **High Rank Tickets Category**:")], components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("select_ticketcat_highrank").setPlaceholder("Pick a category").setChannelTypes([ChannelType.GuildCategory]))] });
    if (id === "setup_ticket_support_ping") return interaction.update({ embeds: [infoEmbed("Choose the **Support Ping Role**:")], components: [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId("select_ticketping_support").setPlaceholder("Pick a role").setMaxValues(1))] });
    if (id === "setup_ticket_high_ping")    return interaction.update({ embeds: [infoEmbed("Choose the **High Rank Ping Role**:")], components: [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId("select_ticketping_highrank").setPlaceholder("Pick a role").setMaxValues(1))] });
    if (id === "setup_ticket_ping_management") {
        if (!gc.managementRoles.length) return interaction.reply({ embeds: [errorEmbed("Set Management roles first.")], flags: MessageFlags.Ephemeral });
        gc.ticketHighRankPingRoleId = gc.managementRoles[0]; saveConfig();
        return updateSetupMessage(interaction, "tickets");
    }

    if (id === "setup_an_toggle")    { gc.antinuke.enabled = !gc.antinuke.enabled; saveConfig(); return updateSetupMessage(interaction, "antinuke"); }
    if (id === "setup_an_threshold") {
        const modal = new ModalBuilder().setCustomId("modal_an_threshold").setTitle("Set Anti-Nuke Threshold");
        modal.addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId("threshold").setLabel("Trigger after N events (2-20)").setStyle(TextInputStyle.Short).setValue(String(gc.antinuke.threshold)).setRequired(true)));
        return interaction.showModal(modal);
    }
    if (id === "setup_an_whitelist")   return interaction.update({ embeds: [infoEmbed("Choose a user to whitelist:")], components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("select_an_whitelist_add").setPlaceholder("Pick a user").setMaxValues(1))] });
    if (id === "setup_an_unwhitelist") return interaction.update({ embeds: [infoEmbed("Choose a user to unwhitelist:")], components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("select_an_whitelist_remove").setPlaceholder("Pick a user").setMaxValues(1))] });
    if (id === "setup_an_list") { const list = gc.antinuke.whitelist.length ? gc.antinuke.whitelist.map(id => "<@" + id + ">").join(", ") : "None"; return interaction.reply({ embeds: [infoEmbed("**Whitelisted:** " + list)], flags: MessageFlags.Ephemeral }); }
    if (id === "setup_an_watchlist") {
        const now = Date.now();
        const entries = Object.entries(gc.antinuke.watchlist).filter(([, e]) => e > now);
        if (!entries.length) return interaction.reply({ embeds: [infoEmbed("No users on rejoin watch.")], flags: MessageFlags.Ephemeral });
        return interaction.reply({ embeds: [infoEmbed("**Watch:**\n" + entries.map(([uid, e]) => "• <@" + uid + "> — <t:" + ((e / 1000) | 0) + ":R>").join("\n"))], flags: MessageFlags.Ephemeral });
    }
    if (id === "setup_an_reset") { gc.antinuke.counters = {}; saveConfig(); return updateSetupMessage(interaction, "antinuke"); }

    if (id === "setup_post_tickets") { await interaction.channel.send({ embeds: [buildTicketPanelEmbed(guild)], components: buildTicketPanelRows() }); return interaction.reply({ embeds: [successEmbed("Ticket panel posted.")], flags: MessageFlags.Ephemeral }); }

    const tplMap = {
        setup_tpl_accept:  { key: "accept",  name: "Accept DM",  label: "Vars: {server} {notes}" },
        setup_tpl_deny:    { key: "deny",    name: "Deny DM",    label: "Vars: {server} {reason}" },
        setup_tpl_promote: { key: "promote", name: "Promote DM", label: "Vars: {server} {rank} {notes}" },
        setup_tpl_demote:  { key: "demote",  name: "Demote DM",  label: "Vars: {server} {rank} {notes}" },
        setup_tpl_infract: { key: "infract", name: "Infract DM", label: "Vars: {server} {type} {reason} {notes}" }
    };
    if (tplMap[id]) {
        const cfg = tplMap[id];
        const v = (gc.dmTemplates[cfg.key] || "").slice(0, 2000);
        const modal = new ModalBuilder().setCustomId("modal_tpl_" + cfg.key).setTitle("Edit " + cfg.name);
        const input = new TextInputBuilder().setCustomId("template").setLabel(cfg.label.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000);
        if (v) input.setValue(v);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    if (id.startsWith("vote_"))   return handleVoteButton(interaction);
    if (id === "ticket_open_menu") return interaction.reply({ embeds: [infoEmbed("**Which support do you need?**")], components: buildTicketTypeRows(), flags: MessageFlags.Ephemeral });
    if (id === "ticket_rules")    return interaction.reply({ embeds: [buildTicketRulesEmbed(guild)], flags: MessageFlags.Ephemeral });
    if (id === "ticket_type_support")  return handleTicketCreate(interaction, "support");
    if (id === "ticket_type_highrank") return handleTicketCreate(interaction, "highrank");
    if (id === "ticket_close") {
        const reason = "Closed via button";
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("ticket_close_confirm_" + interaction.channel.id).setLabel("Confirm Close").setEmoji("✅").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("ticket_close_cancel_" + interaction.channel.id).setLabel("Cancel").setEmoji("❌").setStyle(ButtonStyle.Secondary)
        );
        const sent = await interaction.reply({ embeds: [infoEmbed("Are you sure you want to close this ticket?\n**Reason:** " + reason)], components: [row], withResponse: true });
        _pendingCloseConfirmations.set(sent.id, { userId: interaction.user.id, channelId: interaction.channel.id, guildId: guild.id, reason, expiresAt: Date.now() + TICKET_CLOSE_CONFIRM_MS });
        return;
    }
}

// ==========================================
// SELECT HANDLER
// ==========================================

async function handleSelect(interaction) {
    const id = interaction.customId;
    const gc = getGuildConfig(interaction.guild.id);

    if (id.startsWith("select_channel_")) { gc[id.slice("select_channel_".length)] = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "channels"); }
    if (id.startsWith("select_role_")) {
        const key = id.slice("select_role_".length);
        const values = interaction.values;
        if (key === "hrPingRoleId") gc[key] = values[0];
        else for (const rid of values) if (!gc[key].includes(rid)) gc[key].push(rid);
        invalidateTierCache(interaction.guild.id);
        saveConfig();
        return updateSetupMessage(interaction, "roles");
    }
    if (id === "select_ticketcat_support")  { gc.ticketSupportCategoryId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_ticketcat_highrank") { gc.ticketHighRankCategoryId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_ticketping_support")  { gc.ticketSupportPingRoleId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_ticketping_highrank") { gc.ticketHighRankPingRoleId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_an_whitelist_add")    { const uid = interaction.values[0]; if (!gc.antinuke.whitelist.includes(uid)) gc.antinuke.whitelist.push(uid); saveConfig(); return updateSetupMessage(interaction, "antinuke"); }
    if (id === "select_an_whitelist_remove") { const uid = interaction.values[0]; gc.antinuke.whitelist = gc.antinuke.whitelist.filter(x => x !== uid); saveConfig(); return updateSetupMessage(interaction, "antinuke"); }
    if (id === "select_am_link_wl") {
        gc.automod.linkWhitelistChannelIds = [...new Set([...gc.automod.linkWhitelistChannelIds, ...interaction.values])];
        saveConfig();
        return updateSetupMessage(interaction, "automod");
    }

    if (id === "select_cc_delete") {
        const name = interaction.values[0];
        if (gc.customCommands[name]) {
            delete gc.customCommands[name];
            saveConfig();
            await deleteCustomCommandSlash(interaction.guild, name);
        }
        return updateSetupMessage(interaction, "customcommands");
    }
    if (id === "select_cc_edit") {
        const name = interaction.values[0];
        const cc = gc.customCommands[name];
        if (!cc) return interaction.reply({ embeds: [errorEmbed("Command not found.")], flags: MessageFlags.Ephemeral });

        const modal = new ModalBuilder().setCustomId("modal_cc_edit_" + name).setTitle("Edit: " + name);
        const responseInput = new TextInputBuilder()
            .setCustomId("response").setLabel("Response text").setStyle(TextInputStyle.Paragraph)
            .setRequired(true).setMaxLength(2000).setValue((cc.response || "").slice(0, 2000));
        const typeInput = new TextInputBuilder()
            .setCustomId("type").setLabel("Type: 'text' or 'embed'").setStyle(TextInputStyle.Short)
            .setRequired(true).setMaxLength(5).setValue(cc.type || "text");
        const colorInput = new TextInputBuilder()
            .setCustomId("color").setLabel("Embed color (hex, only for embed)").setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(7).setValue(cc.color ? "#" + cc.color.toString(16).padStart(6, "0") : "#2563EB");
        const deleteInput = new TextInputBuilder()
            .setCustomId("deletetrigger").setLabel("Delete trigger message? (yes/no)").setStyle(TextInputStyle.Short)
            .setRequired(false).setMaxLength(3).setValue(cc.deleteTrigger ? "yes" : "no");

        modal.addComponents(
            new ActionRowBuilder().addComponents(responseInput),
            new ActionRowBuilder().addComponents(typeInput),
            new ActionRowBuilder().addComponents(colorInput),
            new ActionRowBuilder().addComponents(deleteInput)
        );
        return interaction.showModal(modal);
    }
}

// ==========================================
// MODAL HANDLER
// ==========================================

async function handleModal(interaction) {
    const id = interaction.customId;
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);

    if (id === "modal_prefix") {
        const prefix = interaction.fields.getTextInputValue("prefix");
        if (/\s/.test(prefix)) return interaction.reply({ embeds: [errorEmbed("No spaces.")], flags: MessageFlags.Ephemeral });
        setPrefix(guild.id, prefix);
        broadcast(guild, logEmbed("Prefix Changed", "**New prefix:** `" + prefix + "`\n**By:** " + interaction.user.tag, WEBHOOK_COLOR), ["log"]).catch(() => {});
        return interaction.reply({ embeds: [successEmbed("Prefix: `" + prefix + "`.")], flags: MessageFlags.Ephemeral });
    }
    if (id === "modal_webhook") {
        const url = interaction.fields.getTextInputValue("url");
        if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(url)) return interaction.reply({ embeds: [errorEmbed("Invalid URL.")], flags: MessageFlags.Ephemeral });
        gc.webhookUrl = url; saveConfig();
        broadcast(guild, logEmbed("Webhook Set", "**By:** " + interaction.user.tag, WEBHOOK_COLOR), ["log"]).catch(() => {});
        return interaction.reply({ embeds: [successEmbed("Webhook saved.")], flags: MessageFlags.Ephemeral });
    }
    if (id === "modal_am_swear_list") {
        const raw = interaction.fields.getTextInputValue("list");
        const list = raw.split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
        gc.automod.extremeSweatList = list;
        invalidateSwearRegex(guild.id);
        saveConfig();
        return interaction.reply({ embeds: [successEmbed("Swear list updated: **" + list.length + "** words.")], flags: MessageFlags.Ephemeral });
    }
    if (id.startsWith("modal_tpl_")) {
        const key = id.slice("modal_tpl_".length);
        const value = interaction.fields.getTextInputValue("template");
        gc.dmTemplates[key] = value; saveConfig();
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("✅ Template Updated: " + key).setDescription("**New template:**\n" + value).setColor(0x57F287).setTimestamp()], flags: MessageFlags.Ephemeral });
    }
    if (id === "modal_an_threshold") {
        const raw = interaction.fields.getTextInputValue("threshold").trim();
        const n = parseInt(raw, 10);
        if (isNaN(n) || n < 2 || n > 20) return interaction.reply({ embeds: [errorEmbed("Enter 2-20.")], flags: MessageFlags.Ephemeral });
        gc.antinuke.threshold = n; saveConfig();
        return interaction.reply({ embeds: [successEmbed("Threshold: **" + n + "**.")], flags: MessageFlags.Ephemeral });
    }

    if (id === "modal_cc_add") {
        const name = interaction.fields.getTextInputValue("name").trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
        const response = interaction.fields.getTextInputValue("response").trim();
        const typeRaw = (interaction.fields.getTextInputValue("type") || "text").trim().toLowerCase();
        const colorRaw = (interaction.fields.getTextInputValue("color") || "").trim();
        const deleteRaw = (interaction.fields.getTextInputValue("deletetrigger") || "no").trim().toLowerCase();

        if (!name || name.length < 1) return interaction.reply({ embeds: [errorEmbed("Invalid command name.")], flags: MessageFlags.Ephemeral });
        if (!response) return interaction.reply({ embeds: [errorEmbed("Response cannot be empty.")], flags: MessageFlags.Ephemeral });
        if (gc.customCommands[name]) return interaction.reply({ embeds: [errorEmbed("A custom command with that name already exists.")], flags: MessageFlags.Ephemeral });
        if (RESERVED_NAMES.has(name)) return interaction.reply({ embeds: [errorEmbed("That name is reserved for a built-in command.")], flags: MessageFlags.Ephemeral });

        const type = typeRaw === "embed" ? "embed" : "text";
        const colorInt = type === "embed" ? (hexToInt(colorRaw) ?? WEBHOOK_COLOR) : WEBHOOK_COLOR;
        const deleteTrigger = deleteRaw === "yes" || deleteRaw === "y" || deleteRaw === "true";

        gc.customCommands[name] = { response: response.slice(0, 2000), type, color: colorInt, deleteTrigger, enabled: true };
        saveConfig();

        await registerCustomCommandSlash(guild, name);

        return interaction.reply({ embeds: [new EmbedBuilder()
            .setTitle("✅ Custom Command Added")
            .setDescription("Command `" + gc.prefix + name + "` is ready!\nUsers can use **`/" + name + "`** or **`" + gc.prefix + name + "`**.")
            .setColor(0x57F287)
            .addFields(
                { name: "Type", value: type, inline: true },
                { name: "Delete Trigger", value: deleteTrigger ? "Yes" : "No", inline: true },
                { name: "Color", value: type === "embed" ? "#" + colorInt.toString(16).padStart(6, "0") : "—", inline: true }
            )
            .setTimestamp()], flags: MessageFlags.Ephemeral });
    }

    if (id.startsWith("modal_cc_edit_")) {
        const name = id.slice("modal_cc_edit_".length);
        const cc = gc.customCommands[name];
        if (!cc) return interaction.reply({ embeds: [errorEmbed("Command not found.")], flags: MessageFlags.Ephemeral });

        const response = interaction.fields.getTextInputValue("response").trim();
        const typeRaw = (interaction.fields.getTextInputValue("type") || "text").trim().toLowerCase();
        const colorRaw = (interaction.fields.getTextInputValue("color") || "").trim();
        const deleteRaw = (interaction.fields.getTextInputValue("deletetrigger") || "no").trim().toLowerCase();

        if (!response) return interaction.reply({ embeds: [errorEmbed("Response cannot be empty.")], flags: MessageFlags.Ephemeral });

        cc.response = response.slice(0, 2000);
        cc.type = typeRaw === "embed" ? "embed" : "text";
        cc.color = cc.type === "embed" ? (hexToInt(colorRaw) ?? WEBHOOK_COLOR) : WEBHOOK_COLOR;
        cc.deleteTrigger = deleteRaw === "yes" || deleteRaw === "y" || deleteRaw === "true";
        saveConfig();

        return interaction.reply({ embeds: [successEmbed("Updated `" + gc.prefix + name + "`.")], flags: MessageFlags.Ephemeral });
    }
}

// ==========================================
// SUGGESTIONS / FEEDBACK
// ==========================================

async function handleVoteButton(interaction) {
    try {
        const parts = interaction.customId.split("_");
        if (parts.length < 4) return interaction.reply({ embeds: [errorEmbed("Invalid.")], flags: MessageFlags.Ephemeral });
        const [, direction, type, messageId] = parts;
        const gc = getGuildConfig(interaction.guild.id);
        const store = type === "suggestion" ? gc.suggestions : gc.staffFeedback;
        if (!store[messageId]) return interaction.reply({ embeds: [errorEmbed("Invalid vote.")], flags: MessageFlags.Ephemeral });
        const data = store[messageId];
        const userId = interaction.user.id;
        data.upvotes = data.upvotes.filter(id => id !== userId);
        data.downvotes = data.downvotes.filter(id => id !== userId);
        if (direction === "up") data.upvotes.push(userId); else data.downvotes.push(userId);
        saveConfig();
        let updatedEmbed;
        if (type === "suggestion") {
            const author = await client.users.fetch(data.authorId).catch(() => null) || { id: data.authorId, toString: () => "<@" + data.authorId + ">" };
            updatedEmbed = buildSuggestionEmbed(data.content, author, data.upvotes.length, data.downvotes.length, data.status || "pending", data.reviewReason || null);
        } else {
            const [staffMember, author] = await Promise.all([
                client.users.fetch(data.staffId).catch(() => null) || { id: data.staffId, toString: () => "<@" + data.staffId + ">" },
                client.users.fetch(data.authorId).catch(() => null) || { id: data.authorId, toString: () => "<@" + data.authorId + ">" }
            ]);
            updatedEmbed = buildStaffFeedbackEmbed(staffMember, data.content, author, data.upvotes.length, data.downvotes.length);
        }
        await interaction.message.edit({ embeds: [updatedEmbed], components: [buildVoteRow(messageId, type)] });
        return interaction.reply({ embeds: [successEmbed("Voted.")], flags: MessageFlags.Ephemeral });
    } catch (e) { console.error(e); }
}

function buildSuggestionEmbed(suggestion, author, upvotes, downvotes, status = "pending", reviewReason = null) {
    const statusLabel = status === "approved" ? "✅ Approved" : status === "denied" ? "❌ Denied" : "🕒 Pending Review";
    const embed = new EmbedBuilder().setTitle("New Suggestion").setDescription(suggestion).setColor(status === "approved" ? 0x57F287 : status === "denied" ? 0xED4245 : 0x5865F2)
        .addFields(
            { name: "Author", value: String(author), inline: true },
            { name: "Status", value: statusLabel, inline: true },
            { name: "Votes", value: "👍 " + upvotes + " | 👎 " + downvotes, inline: true }
        ).setFooter({ text: "User ID: " + author.id }).setTimestamp();
    if (reviewReason) embed.addFields({ name: "Review Reason", value: reviewReason.slice(0, 1024) });
    return embed;
}
function buildStaffFeedbackEmbed(staffMember, feedback, author, upvotes, downvotes) {
    return new EmbedBuilder().setTitle("Staff Feedback").setDescription(feedback).setColor(0xFEE75C)
        .addFields(
            { name: "Staff Member", value: String(staffMember), inline: true },
            { name: "Submitted By", value: String(author), inline: true },
            { name: "Votes", value: "👍 " + upvotes + " | 👎 " + downvotes, inline: true }
        ).setFooter({ text: "User ID: " + author.id }).setTimestamp();
}
function buildVoteRow(id, type) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("vote_up_" + type + "_" + id).setLabel("Upvote").setEmoji("👍").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("vote_down_" + type + "_" + id).setLabel("Downvote").setEmoji("👎").setStyle(ButtonStyle.Danger)
    );
}

// ==========================================
// PANELS
// ==========================================

function buildTicketPanelEmbed(guild) {
    return new EmbedBuilder().setTitle("🎫 Need Assistance?")
        .setDescription("**" + guild.name + " | Support Assistant**\n\n⚙️ **Need Assistance?**\n> Click **Open a Ticket** below.\n\nℹ️ **Server Rules**\n> Please review the Ticket Rules before proceeding.\n\n**To close your ticket:** use `/close` or the 🔒 button.")
        .setColor(EMBED_ACCENT).setThumbnail(guild.iconURL({ size: 256 }))
        .setFooter({ text: guild.name + " • Support System", iconURL: guild.iconURL() || undefined }).setTimestamp();
}
function buildTicketPanelRows() {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_open_menu").setLabel("Open a Ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("ticket_rules").setLabel("Ticket Rules").setEmoji("📋").setStyle(ButtonStyle.Secondary)
    )];
}
function buildTicketTypeRows() {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_type_support").setLabel("General Support").setEmoji("⚙️").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("ticket_type_highrank").setLabel("High Rank Tickets").setEmoji("🛡️").setStyle(ButtonStyle.Danger)
    )];
}
function buildTicketRulesEmbed(guild) {
    return new EmbedBuilder().setTitle("📋 Ticket Rules")
        .setDescription(
            "**1.** Be patient and do not ping support roles.\n**2.** Be respectful.\n**3.** Respect high-ranking members.\n**4.** No joke/troll tickets.\n**5.** One ticket per issue.\n**6.** Stay on topic.\n**7.** False info = punishment.\n**8.** No spam or arguing.\n**9.** Follow all server rules.\n**10.** Staff may close inactive tickets.\n**11.** Harassment = zero tolerance.\n**12.** Proof may be requested."
        )
        .setColor(EMBED_ACCENT).setFooter({ text: guild.name + " • Ticket Rules", iconURL: guild.iconURL() || undefined }).setTimestamp();
}

// ==========================================
// MESSAGE HANDLER
// ==========================================

client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (!message.guild) return;
    if (message.content === undefined || message.content === null) return;

    const guild = message.guild;
    const gc = getGuildConfig(guild.id);
    const member = message.member;
    const content = message.content;
    const prefix = getPrefix(guild.id);

    if (gc.automod.ignoredChannelIds && gc.automod.ignoredChannelIds.includes(message.channel.id)) {
        // still handle prefix commands? No, ignore everything automod-related but allow commands? Keep simple: skip automod only
    }

    const ignored = gc.automod.ignoredChannelIds?.includes(message.channel.id);

    // Automod: extreme swear
    if (!ignored && gc.automod.extremeSweatEnabled && member && content && !isExempt(member) && !canRunCommand(member, "setup")) {
        const regex = getSwearRegex(guild.id);
        if (regex) {
            regex.lastIndex = 0;
            if (regex.test(content)) {
                regex.lastIndex = 0;
                message.delete().catch(() => {});
                let muted = false;
                try { if (member.moderatable) { await member.timeout(SWEAR_MUTE_MS, "Auto-Mod: extreme language"); muted = true; } } catch {}

                const hrPing = gc.hrPingRoleId ? "<@&" + gc.hrPingRoleId + ">" : "";
                const embed = new EmbedBuilder().setTitle("🤬 Extreme Language Detected").setColor(0xED4245)
                    .setDescription(
                        "**User:** " + message.author + " (`" + message.author.tag + "`)\n" +
                        "**Channel:** " + message.channel + "\n" +
                        "**Action:** " + (muted ? "Muted 60 minutes" : "Mute failed (permissions?)") + "\n" +
                        "**Content:** ||" + content.slice(0, 1000) + "||"
                    )
                    .setThumbnail(message.author.displayAvatarURL()).setTimestamp();
                broadcast(guild, embed, ["log", "staff", "webhook"]).catch(() => {});
                if (hrPing && gc.logChannelId) {
                    const lc = guild.channels.cache.get(gc.logChannelId);
                    if (lc) lc.send({ content: "🚨 " + hrPing + " — Extreme language detected", allowedMentions: { roles: [gc.hrPingRoleId] } }).catch(() => {});
                }
                recordHistory(guild.id, message.author.id, { type: "automod:swear", reason: "Extreme language", moderator: "Auto-Mod", at: Date.now(), guildId: guild.id });
                return;
            }
        }
    }

    // Automod: link filter
    if (!ignored && gc.automod.linkFilterEnabled && member && content && !isExempt(member) && !canRunCommand(member, "setup")) {
        if (containsLink(content) && !gc.automod.linkWhitelistChannelIds.includes(message.channel.id)) {
            message.delete().catch(() => {});
            message.channel.send({ content: message.author.toString() + " — links are not allowed in this channel." })
                .then(m => setTimeout(() => m.delete().catch(() => {}), 5000)).catch(() => {});
            const embed = new EmbedBuilder().setTitle("🔗 Link Blocked").setColor(0xFEE75C)
                .setDescription("**User:** " + message.author + " (`" + message.author.tag + "`)\n**Channel:** " + message.channel + "\n**Content:** ||" + content.slice(0, 1000) + "||")
                .setThumbnail(message.author.displayAvatarURL()).setTimestamp();
            broadcast(guild, embed, ["log", "webhook"]).catch(() => {});
            return;
        }
    }

    // Ghost ping
    if (gc.automod.ghostPingEnabled && message.mentions.members?.size && member && !isExempt(member)) {
        const others = [...message.mentions.members.keys()].filter(id => id !== message.author.id);
        if (others.length) {
            _recentPingedMessages.set(message.id, { mentions: others, channelId: message.channel.id, guildId: guild.id, authorId: message.author.id, content: content.slice(0, 200), at: Date.now() });
            if (_recentPingedMessages.size > GHOST_MAP_MAX) {
                const now = Date.now();
                for (const [k, v] of _recentPingedMessages) if (now - v.at > GHOST_PING_TTL) _recentPingedMessages.delete(k);
            }
        }
    }

    // AFK
    if (gc.afk[message.author.id]) clearAfkIfSet(guild, member, message.channel).catch(() => {});
    if (message.mentions.members?.size) notifyAfkMentions(message).catch(() => {});

    // Prefix
    if (!content.startsWith(prefix)) return;
    const raw = content.slice(prefix.length).trim();
    if (!raw) return;
    const args = raw.split(/\s+/);
    const command = (args.shift() || "").toLowerCase();
    if (!command) return;

    const executor = message.author;
    const executorMember = message.member;

    try {
        // Custom commands first
        if (gc.customCommands[command] && gc.customCommands[command].enabled !== false) {
            return runCustomCommand(guild, command, message, false);
        }

        if (command === "help") {
            const ccNames = Object.keys(gc.customCommands || {});
            const visible = [];
            const catMap = [
                { name: "🛠️ Setup", cmds: ["setup", "setprefix", "setuptickets", "set-webhook", "remove-webhook", "acceptsetup", "antinuke"] },
                { name: "👑 HR", cmds: ["accept", "deny", "promote", "demote", "infract"] },
                { name: "🔨 Moderation", cmds: ["mute", "unmute", "warn", "kick", "ban", "unban", "loguser", "robloxhistory"] },
                { name: "🧹 Channel", cmds: ["slowmode", "lock", "unlock", "purge", "announce"] },
                { name: "🔊 Voice", cmds: ["deafen", "undeafen", "moveall"] },
                { name: "🎭 Roles/Nick", cmds: ["addrole", "removerole", "nickname", "nick"] },
                { name: "🎫 Tickets", cmds: ["close", "closeticket", "ticketclose", "ticket"] },
                { name: "🎉 Events", cmds: ["poll", "giveaway", "giveaway-end", "giveaway-reroll", "suggestion-approve", "suggestion-deny"] },
                { name: "🔧 Info", cmds: ["help", "botinfo", "stats", "ping", "uptime", "invite", "membercount", "userinfo", "roleinfo", "banner", "history", "snipe", "roles", "serverinfo", "av", "afk"] },
                { name: "🌐 Public", cmds: ["suggest", "staff-feedback"] }
            ];
            for (const cat of catMap) {
                const allowed = cat.cmds.filter(c => canRunCommand(executorMember, c));
                if (allowed.length) visible.push({ name: cat.name, value: allowed.map(c => "`" + prefix + c + "`").join(" ") });
            }
            if (ccNames.length) visible.push({ name: "🛠️ Custom Commands", value: ccNames.map(n => "`" + prefix + n + "`").join(", ") });
            const embed = new EmbedBuilder().setTitle(guild.name + " — Prefix Commands").setColor(WEBHOOK_COLOR).addFields(visible).setFooter({ text: BOT_VERSION });
            return message.reply({ embeds: [embed] });
        }

        if (command === "botinfo" || command === "stats") { if (!canRunCommand(executorMember, "botinfo")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdBotInfo(message); }
        if (command === "ping") { if (!canRunCommand(executorMember, "ping")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdPing(message, false); }
        if (command === "uptime") { if (!canRunCommand(executorMember, "uptime")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdUptime(message); }
        if (command === "invite") { if (!canRunCommand(executorMember, "invite")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdInvite(message); }
        if (command === "membercount" || command === "mc") { if (!canRunCommand(executorMember, "membercount")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdMemberCount(message); }
        if (command === "userinfo" || command === "whois") { if (!canRunCommand(executorMember, "userinfo")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const target = message.mentions.users.first() || (args[0] ? await resolveUser(client, args[0]) : null) || executor; return cmdUserInfo(message, false, target); }
        if (command === "roleinfo") { if (!canRunCommand(executorMember, "roleinfo")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const role = message.mentions.roles.first() || (args[0] ? guild.roles.cache.get(args[0].replace(/\D/g, "")) : null); if (!role) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "roleinfo @role`")] }); return cmdRoleInfo(message, role); }
        if (command === "banner") { if (!canRunCommand(executorMember, "banner")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdBanner(message, message.mentions.users.first() || executor); }
        if (command === "history") { if (!canRunCommand(executorMember, "history")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const target = message.mentions.users.first() || (args[0] ? await resolveUser(client, args[0]) : null); if (!target) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "history @user`")] }); return cmdHistory(message, target); }
        if (command === "roles") { if (!canRunCommand(executorMember, "roles")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdRoles(message); }
        if (command === "serverinfo") { if (!canRunCommand(executorMember, "serverinfo")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdServerInfo(message); }
        if (command === "afk") { if (!canRunCommand(executorMember, "afk")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdAfk(message, false, args.join(" ").slice(0, 200) || "AFK"); }
        if (command === "av" || command === "avatar") { if (!canRunCommand(executorMember, "av")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdAv(message, message.mentions.users.first() || null); }

        if (command === "slowmode") { if (!canRunCommand(executorMember, "slowmode")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const sec = parseInt(args[0], 10); if (isNaN(sec) || sec < 0 || sec > 21600) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "slowmode <0-21600>`")] }); return cmdSlowmode(message, sec); }
        if (command === "lock") { if (!canRunCommand(executorMember, "lock")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdLock(message, true, args.join(" ") || null); }
        if (command === "unlock") { if (!canRunCommand(executorMember, "unlock")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdLock(message, false, args.join(" ") || null); }
        if (command === "purge" || command === "clear") { if (!canRunCommand(executorMember, "purge")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const amt = parseInt(args[0], 10); if (isNaN(amt)) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "purge <amount>`")] }); return cmdPurge(message, false, amt, message.mentions.users.first() || null); }
        if (command === "deafen" || command === "undeafen") { if (!canRunCommand(executorMember, command)) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const t = await resolveMember(guild, args[0]); if (!t) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + command + " @user`")] }); return cmdDeafen(message, t, command === "deafen", args.slice(1).join(" ") || null); }
        if (command === "moveall") { if (!canRunCommand(executorMember, "moveall")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const ch = message.mentions.channels.first(); if (!ch) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "moveall #voice`")] }); return cmdMoveAll(message, ch); }
        if (command === "announce") { if (!canRunCommand(executorMember, "announce")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const ch = message.mentions.channels.first(); if (!ch) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "announce #channel <message>`")] }); const msg = args.slice(1).join(" "); if (!msg) return message.reply({ embeds: [errorEmbed("Provide a message.")] }); return cmdAnnounce(message, ch, msg); }
        if (command === "addrole" || command === "removerole") { if (!canRunCommand(executorMember, command)) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const t = message.mentions.members.first(); const r = message.mentions.roles.first(); if (!t || !r) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + command + " @user @role`")] }); return cmdAddRole(message, t, r, command === "removerole"); }

        if (command === "nick") {
            if (!canRunCommand(executorMember, "nick")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] });
            const newName = args.join(" ") || null;
            return cmdSelfNick(message, false, newName);
        }
        if (command === "nickname") {
            if (!canRunCommand(executorMember, "nickname")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] });
            const t = message.mentions.members.first();
            if (!t) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "nickname @user [name]`")] });
            return cmdNickname(message, t, args.slice(1).join(" ") || null);
        }

        if (command === "snipe") { if (!canRunCommand(executorMember, "snipe")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); return cmdSnipe(message); }

        if (command === "close" || command === "closeticket" || command === "ticketclose") return performTicketClose(message, false, args.join(" ").slice(0, 400) || null);

        if (command === "ticket" || command === "tadd" || command === "tremove") {
            if (!canRunCommand(executorMember, "ticket")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] });
            const sub = (command === "tadd" ? "add" : command === "tremove" ? "remove" : (args.shift() || "").toLowerCase());
            if (sub === "add") { const target = message.mentions.users.first() || (args[0] ? await resolveUser(client, args[0]) : null); if (!target) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "ticket add @user`")] }); return cmdTicketAdd(message, false, target); }
            if (sub === "remove") { const target = message.mentions.users.first() || (args[0] ? await resolveUser(client, args[0]) : null); if (!target) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "ticket remove @user`")] }); return cmdTicketRemove(message, false, target); }
            if (sub === "rename") { const name = args.join(" "); if (!name) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "ticket rename <name>`")] }); return cmdTicketRename(message, false, name); }
            if (sub === "claim") return cmdTicketClaim(message, false);
            if (sub === "unclaim") return cmdTicketUnclaim(message, false);
            return message.reply({ embeds: [infoEmbed("Usage: `" + prefix + "ticket <add|remove|rename|claim|unclaim>`")] });
        }

        if (command === "mute") { if (!canRunCommand(executorMember, "mute")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const ti = args[0], di = args[1]; const reason = args.slice(2).join(" ") || "No reason provided"; if (!ti || !di) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "mute @user 10m [reason]`")] }); const t = await resolveMember(guild, ti); if (!t) return message.reply({ embeds: [errorEmbed("Member not found.")] }); const r = await doMute(guild, executorMember, t, di, reason); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "unmute") { if (!canRunCommand(executorMember, "unmute")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const t = await resolveMember(guild, args[0]); if (!t) return message.reply({ embeds: [errorEmbed("Member not found.")] }); const r = await doUnmute(guild, executorMember, t, args.slice(1).join(" ") || "No reason provided"); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "warn") { if (!canRunCommand(executorMember, "warn")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const t = await resolveMember(guild, args[0]); if (!t) return message.reply({ embeds: [errorEmbed("Member not found.")] }); const r = await doWarn(guild, executorMember, t, args.slice(1).join(" ") || "No reason provided"); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "kick") { if (!canRunCommand(executorMember, "kick")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const t = await resolveMember(guild, args[0]); if (!t) return message.reply({ embeds: [errorEmbed("Member not found.")] }); const r = await doKick(guild, executorMember, t, args.slice(1).join(" ") || "No reason provided"); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "ban") { if (!canRunCommand(executorMember, "ban")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const target = args[0]; if (!target) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "ban @user|<id> [reason]`")] }); const t = await resolveMember(guild, target); if (t) { const r = await doBan(guild, executorMember, t, args.slice(1).join(" ") || "No reason provided"); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); } else if (/^\d{15,25}$/.test(target)) { const r = await doBan(guild, executorMember, null, args.slice(1).join(" ") || "No reason provided", target); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); } else return message.reply({ embeds: [errorEmbed("Member not found and not a valid ID.")] }); }
        if (command === "unban") { if (!canRunCommand(executorMember, "unban")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const uid = args[0]; if (!uid || !/^\d{15,25}$/.test(uid)) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "unban <userId>`")] }); const r = await doUnban(guild, executorMember, uid, args.slice(1).join(" ") || "No reason provided"); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }

        if (command === "loguser") { if (!canRunCommand(executorMember, "loguser")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const username = args[0]; const rawp = (args[1] || "").toLowerCase(); const reason = args.slice(2).join(" "); const valid = ["warn", "kick", "ban"]; if (!username || !valid.includes(rawp) || !reason) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "loguser <username> <warn|kick|ban> <reason>`")] }); const r = await doLogUser(guild, executor, username, rawp, reason, null); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "robloxhistory") { if (!canRunCommand(executorMember, "robloxhistory")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const username = args.join(" "); if (!username) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "robloxhistory <username>`")] }); return doRobloxHistory(message, false, username); }

        if (command === "accept") { if (!canRunCommand(executorMember, "accept")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const t = await resolveMember(guild, args[0]); if (!t) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "accept @user [notes]`")] }); const r = await doAccept(guild, executor, t.user, args.slice(1).join(" ") || null); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "deny") { if (!canRunCommand(executorMember, "deny")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const t = await resolveMember(guild, args[0]); const reason = args.slice(1).join(" "); if (!t || !reason) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "deny @user <reason>`")] }); const r = await doDeny(guild, executor, t.user, reason, null); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "promote") { if (!canRunCommand(executorMember, "promote")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const t = await resolveMember(guild, args[0]); const rank = args[1]; if (!t || !rank) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "promote @user <rank>`")] }); const r = await doPromote(guild, executor, t.user, rank, args.slice(2).join(" ") || null); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "demote") { if (!canRunCommand(executorMember, "demote")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const t = await resolveMember(guild, args[0]); const rank = args[1]; if (!t || !rank) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "demote @user <rank>`")] }); const r = await doDemote(guild, executor, t.user, rank, args.slice(2).join(" ") || null); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }
        if (command === "infract") { if (!canRunCommand(executorMember, "infract")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const t = await resolveMember(guild, args[0]); const type = (args[1] || "").toLowerCase(); const reason = args.slice(2).join(" ") || "No reason provided"; const validTypes = ["warn", "strike", "demotion", "suspension"]; if (!t || !validTypes.includes(type)) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "infract @user <type> <reason>`")] }); const r = await doInfract(guild, executor, t.user, type, reason, null); return message.reply({ embeds: [r.ok ? successEmbed(r.msg) : errorEmbed(r.msg)] }); }

        if (command === "poll") { if (!canRunCommand(executorMember, "poll")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); const parts = args.join(" ").split("|").map(s => s.trim()).filter(Boolean); if (parts.length < 3) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "poll <question> | <opt1> | <opt2>`")] }); const question = parts[0].slice(0, 250); const options = parts.slice(1, 11).map(o => o.slice(0, 80)); const pollId = crypto.randomBytes(6).toString("hex"); const votes = {}; options.forEach((_, i) => votes[i] = []); const msg = await message.channel.send({ embeds: [buildPollEmbed(question, options, votes, false, null)], components: buildPollRows(options, pollId, false) }); polls.set(pollId, { question, options, votes, messageId: msg.id, channelId: message.channel.id, guildId: guild.id, ended: false, endsAt: null }); return; }
        if (command === "giveaway") {
            if (!canRunCommand(executorMember, "giveaway")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] });
            const rawStr = args.join(" ");
            // Parse: last token(s) as minutes, optional winners, prize is the rest
            const tokens = rawStr.split(/\s+/);
            let mins = null, winners = 1, prizeParts = [];
            // Try last 2 tokens: mins and winners
            if (tokens.length >= 3) {
                const maybeWinners = parseInt(tokens[tokens.length - 1], 10);
                const maybeMins = parseInt(tokens[tokens.length - 2], 10);
                if (!isNaN(maybeMins) && !isNaN(maybeWinners) && maybeMins > 0 && maybeWinners > 0 && maybeWinners <= 20) {
                    mins = maybeMins;
                    winners = maybeWinners;
                    prizeParts = tokens.slice(0, -2);
                }
            }
            if (mins === null && tokens.length >= 2) {
                const maybeMins = parseInt(tokens[tokens.length - 1], 10);
                if (!isNaN(maybeMins) && maybeMins > 0) {
                    mins = maybeMins;
                    prizeParts = tokens.slice(0, -1);
                }
            }
            if (mins === null || !prizeParts.length) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "giveaway <prize> <minutes> [winners]`")] });
            if (mins < 1 || mins > 10080) return message.reply({ embeds: [errorEmbed("Minutes must be 1-10080.")] });
            const prize = prizeParts.join(" ");
            const endsAt = Date.now() + mins * 60 * 1000;
            const giveawayId = crypto.randomBytes(6).toString("hex");
            const giveaway = { prize: prize.slice(0, 200), winners: Math.min(winners, 20), requiredRoleId: null, hostId: executor.id, endsAt, entries: [], ended: false, channelId: message.channel.id, messageId: null };
            const msg = await message.channel.send({ embeds: [buildGiveawayEmbed(giveaway, false, [])], components: buildGiveawayRows(giveawayId, false) });
            giveaway.messageId = msg.id;
            gc.giveaways[giveawayId] = giveaway;
            saveConfig();
            setTimeout(() => endGiveaway(giveawayId), mins * 60 * 1000).unref?.();
            return;
        }

        if (command === "suggest") { if (!canRunCommand(executorMember, "suggest")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); if (!gc.suggestionChannelId) return message.reply({ embeds: [errorEmbed("Suggestions channel not set.")] }); const suggestion = args.join(" "); if (!suggestion) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "suggest <text>`")] }); const ch = guild.channels.cache.get(gc.suggestionChannelId); if (!ch) return message.reply({ embeds: [errorEmbed("Not found.")] }); const sent = await ch.send({ embeds: [buildSuggestionEmbed(suggestion, executor, 0, 0, "pending", null)], components: [buildVoteRow("pending", "suggestion")] }); await sent.edit({ embeds: [buildSuggestionEmbed(suggestion, executor, 0, 0, "pending", null)], components: [buildVoteRow(sent.id, "suggestion")] }); gc.suggestions[sent.id] = { authorId: executor.id, content: suggestion, upvotes: [], downvotes: [], createdAt: Date.now(), status: "pending" }; saveConfig(); return message.reply({ embeds: [successEmbed("Suggestion submitted!")] }); }
        if (command === "staff-feedback") { if (!canRunCommand(executorMember, "staff-feedback")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] }); if (!gc.staffFeedbackChannelId) return message.reply({ embeds: [errorEmbed("Staff feedback channel not set.")] }); const staffInput = args[0]; const feedback = args.slice(1).join(" "); if (!staffInput || !feedback) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "staff-feedback @staff <text>`")] }); const staffUser = await resolveUser(client, staffInput); if (!staffUser) return message.reply({ embeds: [errorEmbed("Staff user not found.")] }); const ch = guild.channels.cache.get(gc.staffFeedbackChannelId); if (!ch) return message.reply({ embeds: [errorEmbed("Not found.")] }); const sent = await ch.send({ embeds: [buildStaffFeedbackEmbed(staffUser, feedback, executor, 0, 0)], components: [buildVoteRow("pending", "feedback")] }); await sent.edit({ embeds: [buildStaffFeedbackEmbed(staffUser, feedback, executor, 0, 0)], components: [buildVoteRow(sent.id, "feedback")] }); gc.staffFeedback[sent.id] = { authorId: executor.id, staffId: staffUser.id, content: feedback, upvotes: [], downvotes: [], createdAt: Date.now() }; saveConfig(); return message.reply({ embeds: [successEmbed("Feedback submitted!")] }); }

    } catch (e) {
        console.error("prefix cmd error:", e);
        try { await message.reply({ embeds: [errorEmbed("Error: " + (e?.message || "unknown"))] }); } catch {}
    }
});

// ==========================================
// DELETE / EDIT / MEMBER EVENTS
// ==========================================

client.on("messageDelete", async message => {
    try {
        if (!message.guild) return;
        const gc = getGuildConfig(message.guild.id);
        if (message.author && !message.author.bot) {
            _snipeCache.set(message.channel.id, { author: message.author, content: message.content || "", at: Date.now(), attachments: message.attachments ? [...message.attachments.values()].map(a => a.url) : [] });
            broadcast(message.guild, logEmbed("Message Deleted",
                "**Author:** " + (message.author?.tag || "Unknown") + "\n**Channel:** " + message.channel + "\n**Content:** " + (message.content || "*None*").slice(0, 1500), 0xED4245), ["log"]).catch(() => {});
        }
        if (!gc.automod.ghostPingEnabled) return;
        const tracked = _recentPingedMessages.get(message.id);
        if (!tracked) return;
        _recentPingedMessages.delete(message.id);
        if (Date.now() - tracked.at > GHOST_PING_TTL) return;
        const author = await message.guild.members.fetch(tracked.authorId).catch(() => null);
        if (!author || isExempt(author)) return;
        const embed = new EmbedBuilder().setTitle("👻 Ghost Ping Detected").setColor(0xFEE75C)
            .setDescription("**User:** " + author.user.tag + " (`" + author.id + "`)\n**Channel:** <#" + tracked.channelId + ">\n**Pinged:** " + tracked.mentions.map(id => "<@" + id + ">").join(", ") + "\n**Content:** " + (tracked.content || "*empty*"))
            .setThumbnail(author.user.displayAvatarURL()).setTimestamp();
        broadcast(message.guild, embed, ["log", "staff", "webhook"]).catch(() => {});
        author.send({ embeds: [new EmbedBuilder().setTitle("⚠️ Ghost Ping Warning").setDescription("You ghost-pinged in **" + message.guild.name + "**. Please don't do that.").setColor(0xFEE75C).setTimestamp()] }).catch(() => {});
        recordHistory(message.guild.id, author.id, { type: "automod:ghostping", reason: "Ghost ping", moderator: "Auto-Mod", at: Date.now(), guildId: message.guild.id });
    } catch (e) { console.error("messageDelete:", e); }
});

client.on("messageUpdate", async (o, n) => {
    try {
        if (!o.guild || o.author?.bot || o.content === n.content) return;
        broadcast(o.guild, logEmbed("Message Edited", "**Author:** " + (o.author?.tag || "Unknown") + "\n**Channel:** " + o.channel + "\n**Before:** " + (o.content || "*None*").slice(0, 800) + "\n**After:** " + (n.content || "*None*").slice(0, 800), 0xFEE75C), ["log"]).catch(() => {});

        // Automod on edit
        const gc = getGuildConfig(o.guild.id);
        if (gc.automod.ignoredChannelIds?.includes(n.channel.id)) return;
        const member = n.member;
        if (!member || isExempt(member) || canRunCommand(member, "setup")) return;
        const newContent = n.content || "";
        if (gc.automod.extremeSweatEnabled) {
            const regex = getSwearRegex(o.guild.id);
            if (regex) {
                regex.lastIndex = 0;
                if (regex.test(newContent)) {
                    regex.lastIndex = 0;
                    n.delete().catch(() => {});
                    let muted = false;
                    try { if (member.moderatable) { await member.timeout(SWEAR_MUTE_MS, "Auto-Mod: extreme language (edit)"); muted = true; } } catch {}
                    const embed = new EmbedBuilder().setTitle("🤬 Extreme Language Detected (Edit)").setColor(0xED4245)
                        .setDescription("**User:** " + n.author + " (`" + n.author.tag + "`)\n**Channel:** " + n.channel + "\n**Action:** " + (muted ? "Muted 60 minutes" : "Mute failed") + "\n**Content:** ||" + newContent.slice(0, 1000) + "||")
                        .setThumbnail(n.author.displayAvatarURL()).setTimestamp();
                    broadcast(o.guild, embed, ["log", "staff", "webhook"]).catch(() => {});
                    recordHistory(o.guild.id, n.author.id, { type: "automod:swear", reason: "Extreme language (edit)", moderator: "Auto-Mod", at: Date.now(), guildId: o.guild.id });
                    return;
                }
            }
        }
        if (gc.automod.linkFilterEnabled && containsLink(newContent) && !gc.automod.linkWhitelistChannelIds.includes(n.channel.id)) {
            n.delete().catch(() => {});
            const embed = new EmbedBuilder().setTitle("🔗 Link Blocked (Edit)").setColor(0xFEE75C)
                .setDescription("**User:** " + n.author + " (`" + n.author.tag + "`)\n**Channel:** " + n.channel + "\n**Content:** ||" + newContent.slice(0, 1000) + "||")
                .setThumbnail(n.author.displayAvatarURL()).setTimestamp();
            broadcast(o.guild, embed, ["log", "webhook"]).catch(() => {});
        }
    } catch (e) { console.error("messageUpdate:", e); }
});

client.on("guildMemberAdd", async member => {
    try {
        const guild = member.guild;
        const gc = getGuildConfig(guild.id);
        const wasMuted = await checkRejoinWatch(member);
        if (gc.welcomeChannelId) {
            const ch = guild.channels.cache.get(gc.welcomeChannelId);
            if (ch) {
                const n = guild.memberCount;
                ch.send({ content: member.toString() + " Hello, and welcome to **" + guild.name + "**! You are our **" + n + getOrdinalSuffix(n) + "** member, enjoy your stay!" }).catch(() => {});
            }
        }
        const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
        broadcast(guild, logEmbed("Member Joined",
            "**User:** " + member + " (`" + member.user.tag + "`)\n**ID:** `" + member.id + "`\n**Account Age:** " + accountAge + " days\n**Member Count:** " + guild.memberCount + (wasMuted ? "\n\n⚠️ **Auto-muted (24h rejoin watch)**" : ""),
            wasMuted ? 0xED4245 : 0x57F287), ["log", "webhook"]).catch(() => {});
    } catch (e) { console.error(e); }
});

client.on("guildMemberRemove", async member => {
    try {
        const gc = getGuildConfig(member.guild.id);
        if (gc.afk[member.id]) { delete gc.afk[member.id]; saveConfig(); }
        broadcast(member.guild, logEmbed("Member Left", "**User:** " + member.user.tag + "\n**ID:** `" + member.id + "`", 0xED4245), ["log", "webhook"]).catch(() => {});
        if (!member.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const executor = await fetchAuditExecutor(member.guild, 20, member.id);
        if (executor) await handleAntinukeEvent(member.guild, executor.id, "Kick");
    } catch (e) { console.error(e); }
});

client.on("channelDelete", async channel => {
    try {
        if (!channel.guild) return;
        const gc = getGuildConfig(channel.guild.id);
        // Cleanup ticket if it was one
        if (gc.tickets[channel.id]) {
            const ticket = gc.tickets[channel.id];
            if (ticket.open) {
                ticket.open = false;
                ticket.closedAt = Date.now();
                ticket.closeReason = "Channel deleted";
                saveConfig();
                broadcast(channel.guild, logEmbed("Ticket Channel Deleted", "**Ticket:** #" + ticket.number + "\n**User:** <@" + ticket.userId + ">\n**Action:** Marked as closed (channel removed).", 0xED4245), ["ticket", "log"]).catch(() => {});
            }
            // Remove old closed tickets from config
            for (const [cid, t] of Object.entries(gc.tickets)) {
                if (!t.open && Date.now() - (t.closedAt || 0) > 7 * 24 * 60 * 60 * 1000) delete gc.tickets[cid];
            }
            saveConfig();
        }
        broadcast(channel.guild, logEmbed("Channel Deleted", "**Name:** " + channel.name + "\n**ID:** `" + channel.id + "`", 0xED4245), ["log"]).catch(() => {});
        if (!channel.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const exec = await fetchAuditExecutor(channel.guild, 12, channel.id);
        if (exec) await handleAntinukeEvent(channel.guild, exec.id, "Channel Delete");
    } catch (e) { console.error(e); }
});

client.on("roleDelete", async role => {
    try {
        broadcast(role.guild, logEmbed("Role Deleted", "**Role:** " + role.name + "\n**ID:** `" + role.id + "`", 0xED4245), ["log"]).catch(() => {});
        invalidateTierCache(role.guild.id);
        if (!role.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const exec = await fetchAuditExecutor(role.guild, 32, role.id);
        if (exec) await handleAntinukeEvent(role.guild, exec.id, "Role Delete");
    } catch (e) { console.error(e); }
});

client.on("guildBanAdd", async ban => {
    try {
        broadcast(ban.guild, logEmbed("Member Banned", "**User:** " + ban.user.tag + "\n**ID:** `" + ban.user.id + "`\n**Reason:** " + (ban.reason || "None"), 0xED4245), ["log", "webhook"]).catch(() => {});
        if (!ban.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const exec = await fetchAuditExecutor(ban.guild, 22, ban.user.id);
        if (exec && exec.id !== client.user.id) await handleAntinukeEvent(ban.guild, exec.id, "Ban");
    } catch (e) { console.error(e); }
});

client.on("roleCreate", async r => { try { broadcast(r.guild, logEmbed("Role Created", "**Role:** " + r + "\n**ID:** `" + r.id + "`", 0x57F287), ["log"]).catch(() => {}); } catch {} });
client.on("channelCreate", async c => { try { if (!c.guild) return; broadcast(c.guild, logEmbed("Channel Created", "**Channel:** " + c + "\n**Name:** " + c.name, 0x57F287), ["log"]).catch(() => {}); } catch {} });

client.on("voiceStateUpdate", async (o, n) => {
    try {
        const member = n.member || o.member;
        if (!member) return;
        if (!o.channelId && n.channelId)       broadcast(member.guild, logEmbed("Voice Joined", "**User:** " + member + "\n**Channel:** " + n.channel, 0x57F287), ["log"]).catch(() => {});
        else if (o.channelId && !n.channelId)  broadcast(member.guild, logEmbed("Voice Left",   "**User:** " + member + "\n**Channel:** " + o.channel, 0xED4245), ["log"]).catch(() => {});
        else if (o.channelId !== n.channelId)  broadcast(member.guild, logEmbed("Voice Switched", "**User:** " + member + "\n**From:** " + o.channel + "\n**To:** " + n.channel, 0xFEE75C), ["log"]).catch(() => {});
    } catch {}
});

// ==========================================
// GLOBAL ERRORS
// ==========================================

client.on("error", e => console.error("client error:", e));
client.on("warn",  w => console.warn("client warn:", w));
process.on("unhandledRejection", e => console.error("unhandled:", e));
process.on("uncaughtException",  e => console.error("uncaught:", e));
process.on("SIGINT",  () => { flushSave(); process.exit(0); });
process.on("SIGTERM", () => { flushSave(); process.exit(0); });

// ==========================================
// LOGIN
// ==========================================

client.login(TOKEN);