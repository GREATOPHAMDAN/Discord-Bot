// ==========================================
// EAGLE COUNTY ROLEPLAY BOT - V.1.8
// ==========================================

const {
    Client, GatewayIntentBits, Partials, EmbedBuilder,
    SlashCommandBuilder, PermissionFlagsBits,
    ActionRowBuilder, ButtonBuilder, ButtonStyle,
    ChannelType, ModalBuilder, TextInputBuilder, TextInputStyle,
    ChannelSelectMenuBuilder, RoleSelectMenuBuilder, UserSelectMenuBuilder,
    WebhookClient, AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");

dotenv.config();
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error("ERROR: TOKEN missing from .env"); process.exit(1); }

// ==========================================
// CONSTANTS
// ==========================================

const CONFIG_FILE = path.join(__dirname, "config.json");
const DEFAULT_PREFIX = "!";
const DAILY_LIMIT = 15;
const WEBHOOK_COLOR = 0x2563EB;
const EMBED_ACCENT  = 0xFF8C00;

const REJOIN_WATCH_MS = 24 * 60 * 60 * 1000;
const REJOIN_MUTE_MS  = 24 * 60 * 60 * 1000;

const DEFAULT_ANTINUKE = {
    enabled: true, threshold: 5, windowMs: 60000,
    whitelist: [], counters: {}, watchlist: {}
};

const TIER_INCLUDES = {
    staff: ["staff"],
    admin: ["admin", "staff"],
    highrank: ["highrank", "admin", "staff"],
    management: ["management", "highrank", "admin", "staff"]
};

const DEFAULT_COMMAND_PERMS = {
    // Setup (Management only)
    setup: ["management"], setprefix: ["management"], setupverify: ["management"],
    setuptickets: ["management"], "set-webhook": ["management"],
    "remove-webhook": ["management"], antinuke: ["management"],

    // HR
    acceptsetup: ["highrank", "management"], accept: ["highrank", "management"],
    promote: ["highrank", "management"], demote: ["highrank", "management"],
    infract: ["highrank", "management"],

    // Moderation
    mute: ["staff", "admin", "highrank", "management"],
    unmute: ["staff", "admin", "highrank", "management"],
    warn: ["staff", "admin", "highrank", "management"],
    kick: ["staff", "admin", "highrank", "management"],
    ban: ["admin", "highrank", "management"],
    unban: ["admin", "highrank", "management"],

    // Logging
    loguser: ["staff", "admin", "highrank", "management"],

    // NEW — Utility
    roles: ["staff", "admin", "highrank", "management"], // staff-only utility
    serverinfo: ["everyone"],
    afk: ["everyone"],
    av: ["everyone"],

    // Public
    suggest: ["everyone"], "staff-feedback": ["everyone"], help: ["everyone"]
};

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
        Partials.User, Partials.Reaction
    ],
    ws: { compress: false }
});

// ==========================================
// CONFIG (cached, debounced saves)
// ==========================================

function createDefaultGuildConfig() {
    return {
        prefix: DEFAULT_PREFIX,
        logChannelId: null, verificationLogChannelId: null, transcriptChannelId: null,
        welcomeChannelId: null, suggestionChannelId: null, staffFeedbackChannelId: null,
        staffLogChannelId: null, hrLogChannelId: null, verifyChannelId: null, ticketLogChannelId: null,
        ticketSupportCategoryId: null, ticketSupportPingRoleId: null,
        ticketHighRankCategoryId: null, ticketHighRankPingRoleId: null,
        webhookUrl: null,
        staffRoles: [], adminRoles: [], highRankRoles: [], managementRoles: [],
        exemptRoles: [], verifyRoleId: null, acceptRoleIds: [],
        commandPerms: {},
        dmTemplates: {
            accept: "Congratulations! Your application for **{server}** has been accepted.\n\nPlease review the server for next steps.",
            promote: "You have been **promoted** in **{server}**!\n\n**New Rank:** {rank}",
            demote: "You have been **demoted** in **{server}**.\n\n**New Rank:** {rank}",
            infract: "You have received an infraction in **{server}**.\n\n**Type:** {type}\n**Reason:** {reason}"
        },
        antinuke: JSON.parse(JSON.stringify(DEFAULT_ANTINUKE)),
        verifySessions: {}, verifiedUsers: {}, tickets: {},
        ticketCounter: 0, suggestions: {}, staffFeedback: {}, limits: {},
        // NEW — AFK storage: { userId: { reason, since } }
        afk: {}
    };
}

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            const nc = { guilds: {} };
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(nc, null, 4));
            return nc;
        }
        const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
        if (!data.guilds) data.guilds = {};
        return data;
    } catch (e) {
        console.error("loadConfig:", e);
        return { guilds: {} };
    }
}

let config = loadConfig();

let saveTimer = null;
let saveDirty = false;
function saveConfig() {
    saveDirty = true;
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        if (!saveDirty) return;
        saveDirty = false;
        fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 4), e => {
            if (e) console.error("saveConfig:", e);
        });
    }, 250);
}
function flushSave() {
    if (!saveDirty) return;
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4)); } catch {}
    saveDirty = false;
}

const guildConfigCache = new Map();

function getGuildConfig(guildId) {
    let gc = guildConfigCache.get(guildId);
    if (gc) return gc;

    if (!config.guilds[guildId]) {
        config.guilds[guildId] = createDefaultGuildConfig();
        saveConfig();
    }
    gc = config.guilds[guildId];

    const defaults = createDefaultGuildConfig();
    for (const k in defaults) if (gc[k] === undefined) gc[k] = defaults[k];
    if (gc.acceptRoleId && (!gc.acceptRoleIds || gc.acceptRoleIds.length === 0)) gc.acceptRoleIds = [gc.acceptRoleId];
    if (gc.ticketCategoryId && !gc.ticketSupportCategoryId) gc.ticketSupportCategoryId = gc.ticketCategoryId;
    if (gc.ticketCategoryHighRankId && !gc.ticketHighRankCategoryId) gc.ticketHighRankCategoryId = gc.ticketCategoryHighRankId;
    if (!Array.isArray(gc.highRankRoles)) gc.highRankRoles = [];
    if (!gc.commandPerms) gc.commandPerms = {};
    if (!gc.antinuke) gc.antinuke = JSON.parse(JSON.stringify(DEFAULT_ANTINUKE));
    if (!gc.antinuke.counters) gc.antinuke.counters = {};
    if (!Array.isArray(gc.antinuke.whitelist)) gc.antinuke.whitelist = [];
    if (!gc.antinuke.watchlist) gc.antinuke.watchlist = {};
    if (!gc.afk) gc.afk = {}; // NEW

    guildConfigCache.set(guildId, gc);
    return gc;
}

// ==========================================
// PERMISSIONS
// ==========================================

function getRequiredTiers(guildId, commandName) {
    const gc = getGuildConfig(guildId);
    const override = gc.commandPerms[commandName];
    if (override) return override;
    return DEFAULT_COMMAND_PERMS[commandName] || ["management"];
}

function getMemberTiers(member) {
    if (!member) return new Set();
    const gc = getGuildConfig(member.guild.id);
    const tiers = new Set();
    if (member.permissions.has(PermissionFlagsBits.Administrator)) { tiers.add("admin"); tiers.add("staff"); }
    const roles = member.roles.cache;
    if (gc.staffRoles.length      && roles.some(r => gc.staffRoles.includes(r.id)))      tiers.add("staff");
    if (gc.adminRoles.length      && roles.some(r => gc.adminRoles.includes(r.id)))      tiers.add("admin");
    if (gc.highRankRoles.length   && roles.some(r => gc.highRankRoles.includes(r.id)))   tiers.add("highrank");
    if (gc.managementRoles.length && roles.some(r => gc.managementRoles.includes(r.id))) tiers.add("management");
    return tiers;
}

function canRunCommand(member, commandName) {
    if (!member) return false;
    const required = getRequiredTiers(member.guild.id, commandName);
    if (required.includes("everyone")) return true;

    const memberTiers = getMemberTiers(member);
    const expanded = new Set();
    for (const t of memberTiers) for (const x of (TIER_INCLUDES[t] || [t])) expanded.add(x);
    for (const t of required) if (expanded.has(t)) return true;
    return false;
}

// ==========================================
// HELPERS
// ==========================================

const today = () => new Date().toISOString().split("T")[0];

function getLimitData(guildId, userId) {
    const gc = getGuildConfig(guildId);
    const d = today();
    const l = gc.limits[userId];
    if (!l || l.date !== d) {
        gc.limits[userId] = { date: d, mutes: 0, kicks: 0 };
        saveConfig();
    }
    return gc.limits[userId];
}

const getPrefix = id => getGuildConfig(id).prefix || DEFAULT_PREFIX;

function getOrdinalSuffix(n) {
    const s = ["th", "st", "nd", "rd"], v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

const hasRole = (m, ids) => !!(m?.roles && ids?.length && m.roles.cache.some(r => ids.includes(r.id)));

function isExempt(member) {
    if (!member) return false;
    return hasRole(member, getGuildConfig(member.guild.id).exemptRoles);
}

function canModerate(moderator, target) {
    if (!moderator || !target) return false;
    if (target.id === moderator.id) return false;
    if (target.id === moderator.guild.ownerId) return false;
    const m = moderator.roles?.highest?.position ?? -1;
    const t = target.roles?.highest?.position   ?? -1;
    return t < m;
}

function parseDuration(input) {
    if (!input) return null;
    const m = input.match(/^(\d+)(s|m|h|d)$/i);
    if (!m) return null;
    const amt = +m[1], u = m[2].toLowerCase();
    const ms = amt * ({ s: 1000, m: 60000, h: 3600000, d: 86400000 }[u]);
    return ms > 2419200000 ? null : ms;
}

const generateCode = () => "ECRP-" + crypto.randomBytes(4).toString("hex").toUpperCase();

const TEMPLATE_RE = /\{(\w+)\}/g;
const templateReplace = (tpl, vars) => tpl.replace(TEMPLATE_RE, (_, k) => (vars[k] ?? ""));

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

async function sendToChannel(guild, channelId, embed) {
    if (!channelId) return;
    const ch = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
    if (!ch) return;
    try { await ch.send({ embeds: [embed] }); } catch {}
}

const _whClients = new Map();
async function sendWebhook(guild, embed) {
    const gc = getGuildConfig(guild.id);
    if (!gc.webhookUrl) return;
    try {
        let wh = _whClients.get(gc.webhookUrl);
        if (!wh) { wh = new WebhookClient({ url: gc.webhookUrl }); _whClients.set(gc.webhookUrl, wh); }
        const finalEmbed = EmbedBuilder.from(embed).setColor(WEBHOOK_COLOR);
        if (guild.iconURL()) finalEmbed.setThumbnail(guild.iconURL({ size: 256 }));
        finalEmbed.setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined });
        await wh.send({ username: guild.name, avatarURL: guild.iconURL() || undefined, embeds: [finalEmbed] });
    } catch {}
}

function broadcast(guild, embed, targets) {
    const gc = getGuildConfig(guild.id);
    const promises = [];
    for (const t of targets) {
        if (t === "log")     promises.push(sendToChannel(guild, gc.logChannelId, embed));
        if (t === "verify")  promises.push(sendToChannel(guild, gc.verificationLogChannelId || gc.logChannelId, embed));
        if (t === "staff")   promises.push(sendToChannel(guild, gc.staffLogChannelId, embed));
        if (t === "hr")      promises.push(sendToChannel(guild, gc.hrLogChannelId, embed));
        if (t === "ticket")  promises.push(sendToChannel(guild, gc.ticketLogChannelId, embed));
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
// ROBLOX LOOKUP
// ==========================================

async function lookupRobloxUser(username) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
        const r = await fetch("https://users.roblox.com/v1/usernames/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false }),
            signal: ctrl.signal
        });
        if (!r.ok) return null;
        const d = await r.json();
        if (!d.data?.length) return null;
        const userId = d.data[0].id;

        const [detailsR, avatarR] = await Promise.all([
            fetch("https://users.roblox.com/v1/users/" + userId, { signal: ctrl.signal }),
            fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + userId + "&size=420x420&format=Png&isCircular=false", { signal: ctrl.signal }).catch(() => null)
        ]);
        if (!detailsR.ok) return null;
        const details = await detailsR.json();
        let avatarUrl = null;
        if (avatarR?.ok) {
            const ad = await avatarR.json().catch(() => null);
            if (ad?.data?.length) avatarUrl = ad.data[0].imageUrl;
        }
        return {
            id: userId, username: details.name, displayName: details.displayName,
            description: details.description || "", created: details.created,
            avatarUrl, profileUrl: "https://www.roblox.com/users/" + userId + "/profile"
        };
    } catch { return null; }
    finally { clearTimeout(timer); }
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
    let removed = 0, failed = 0;
    for (const role of all.values()) {
        if (role.position >= myPos || role.managed) { failed++; continue; }
        try { await member.roles.remove(role, reason); removed++; }
        catch { failed++; }
    }
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

    const embed = new EmbedBuilder()
        .setTitle("🚨 ANTI-NUKE TRIGGERED")
        .setDescription(
            "**User:** " + member.user.tag + " (" + member.id + ")\n" +
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
            "**User:** " + member.user.tag + " (" + member.id + ")\n" +
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
// AFK SYSTEM
// ==========================================

/**
 * Clear AFK on a member if they were AFK and send a "Welcome back" notice.
 * Returns true if AFK was cleared.
 */
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

/**
 * Notify the sender if any mentioned member is AFK.
 */
async function notifyAfkMentions(message) {
    if (!message.guild || !message.mentions.members?.size) return;
    const gc = getGuildConfig(message.guild.id);
    if (!Object.keys(gc.afk).length) return;

    const notices = [];
    for (const [id, member] of message.mentions.members) {
        const afk = gc.afk[id];
        if (!afk) continue;
        const duration = formatDuration(Date.now() - afk.since);
        notices.push("💤 **" + member.user.username + "** is AFK: " + afk.reason + " *(for " + duration + ")*");
    }
    if (!notices.length) return;

    const embed = new EmbedBuilder()
        .setDescription(notices.join("\n"))
        .setColor(0xFEE75C)
        .setTimestamp();
    message.reply({ embeds: [embed], allowedMentions: { repliedUser: false } }).catch(() => {});
}

function formatDuration(ms) {
    const s = Math.floor(ms / 1000);
    if (s < 60) return s + "s";
    const m = Math.floor(s / 60);
    if (m < 60) return m + "m";
    const h = Math.floor(m / 60);
    const rm = m % 60;
    if (h < 24) return h + "h " + rm + "m";
    const d = Math.floor(h / 24);
    const rh = h % 24;
    return d + "d " + rh + "h";
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
        new SlashCommandBuilder().setName("setupverify").setDescription("Post the Roblox verification panel"),
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
        new SlashCommandBuilder().setName("promote").setDescription("Promote a user")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addStringOption(o => o.setName("rank").setDescription("New rank").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Notes").setRequired(false)),
        new SlashCommandBuilder().setName("demote").setDescription("Demote a user")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addStringOption(o => o.setName("rank").setDescription("New rank").setRequired(true))
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
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
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

        // ===== NEW UTILITY COMMANDS =====
        new SlashCommandBuilder().setName("roles").setDescription("List all server roles (staff-only)"),
        new SlashCommandBuilder().setName("serverinfo").setDescription("Show information about this server"),
        new SlashCommandBuilder().setName("afk").setDescription("Set yourself as AFK")
            .addStringOption(o => o.setName("reason").setDescription("Why are you AFK?").setRequired(false).setMaxLength(200)),
        new SlashCommandBuilder().setName("av").setDescription("Show your avatar or another user's avatar")
            .addUserOption(o => o.setName("user").setDescription("User (leave empty for yourself)").setRequired(false)),

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
function getSlashCommandsCached() {
    if (!_slashCache) _slashCache = getSlashCommands();
    return _slashCache;
}

async function registerCommands(guild) {
    try { await guild.commands.set(getSlashCommandsCached()); }
    catch (e) { console.error("registerCommands:", guild.name, e.message); }
}

// ==========================================
// READY
// ==========================================

client.once("ready", async () => {
    console.log("--------------------------------");
    console.log("Logged in as " + client.user.tag);
    console.log("Servers: " + client.guilds.cache.size);
    console.log("--------------------------------");

    const jobs = [];
    for (const guild of client.guilds.cache.values()) {
        getGuildConfig(guild.id);
        jobs.push(registerCommands(guild));
    }
    await Promise.all(jobs);

    client.user.setActivity("Eagle County Roleplay | V.1.8");

    for (const guild of client.guilds.cache.values()) {
        const gc = getGuildConfig(guild.id);
        const now = Date.now();
        let changed = false;
        for (const [uid, e] of Object.entries(gc.antinuke.watchlist)) {
            if (now > e) { delete gc.antinuke.watchlist[uid]; changed = true; }
        }
        if (changed) saveConfig();
    }
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
    const titles = { accept: "Application Accepted", promote: "You Have Been Promoted", demote: "You Have Been Demoted", infract: "Infraction Notice" };
    return new EmbedBuilder()
        .setTitle(titles[key] || "Notice")
        .setDescription(text)
        .setColor(key === "demote" || key === "infract" ? 0xED4245 : 0x57F287)
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
    const watchCount = Object.values(an.watchlist).filter(e => e > Date.now()).length;
    const afkCount = Object.keys(gc.afk).length;
    return new EmbedBuilder()
        .setTitle("⚙️ " + guild.name + " — Setup Menu (V.1.8)")
        .setDescription("**Management-only** setup menu.")
        .setColor(WEBHOOK_COLOR)
        .setThumbnail(guild.iconURL({ size: 256 }))
        .addFields(
            { name: "General", value: "**Prefix:** `" + gc.prefix + "`\n**Webhook:** " + (gc.webhookUrl ? "✅" : "❌") + "\n**Anti-Nuke:** " + (an.enabled ? "✅" : "❌") + "\n**AFK Users:** " + afkCount, inline: false },
            { name: "📁 Channels", value: [
                "**Main Log:** " + fmtCh(gc, "logChannelId"),
                "**Verification Log:** " + fmtCh(gc, "verificationLogChannelId"),
                "**Transcripts:** " + fmtCh(gc, "transcriptChannelId"),
                "**Welcome:** " + fmtCh(gc, "welcomeChannelId"),
                "**Suggestions:** " + fmtCh(gc, "suggestionChannelId"),
                "**Staff Feedback:** " + fmtCh(gc, "staffFeedbackChannelId"),
                "**Staff Log:** " + fmtCh(gc, "staffLogChannelId"),
                "**HR Log:** " + fmtCh(gc, "hrLogChannelId"),
                "**Verify Panel:** " + fmtCh(gc, "verifyChannelId"),
                "**Ticket Log:** " + fmtCh(gc, "ticketLogChannelId")
            ].join("\n"), inline: false },
            { name: "🎭 Role Tiers", value: [
                "**Staff:** " + fmtRoleList(gc.staffRoles),
                "**Admin:** " + fmtRoleList(gc.adminRoles),
                "**⭐ High Rank:** " + fmtRoleList(gc.highRankRoles),
                "**Management:** " + fmtRoleList(gc.managementRoles),
                "**Exempt:** " + fmtRoleList(gc.exemptRoles),
                "**Verify Role:** " + fmtRole(gc, "verifyRoleId"),
                "**Accept Roles:** " + fmtRoleList(gc.acceptRoleIds)
            ].join("\n"), inline: false },
            { name: "🎫 Tickets", value: [
                "**Support Category:** " + (gc.ticketSupportCategoryId ? "<#" + gc.ticketSupportCategoryId + ">" : "❌"),
                "**Support Ping:** " + fmtRole(gc, "ticketSupportPingRoleId"),
                "**High Rank Category:** " + (gc.ticketHighRankCategoryId ? "<#" + gc.ticketHighRankCategoryId + ">" : "❌"),
                "**High Rank Ping:** " + fmtRole(gc, "ticketHighRankPingRoleId")
            ].join("\n"), inline: false },
            { name: "🛡️ Anti-Nuke", value: "**Threshold:** " + an.threshold + " / " + (an.windowMs / 1000) + "s\n**Whitelisted:** " + an.whitelist.length + "\n**On Watch:** " + watchCount, inline: false }
        )
        .setFooter({ text: "V.1.8 • " + guild.name, iconURL: guild.iconURL() || undefined })
        .setTimestamp();
}

function buildSetupRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_channels").setLabel("Channels").setEmoji("📁").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_roles").setLabel("Role Tiers").setEmoji("🎭").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_tickets").setLabel("Tickets").setEmoji("🎫").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_perms").setLabel("Permissions").setEmoji("🔐").setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_dm_templates").setLabel("DM Templates").setEmoji("✉️").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_antinuke").setLabel("Anti-Nuke").setEmoji("🛡️").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_prefix").setLabel("Prefix").setEmoji("🔤").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_webhook").setLabel("Webhook").setEmoji("🔗").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_post_verify").setLabel("Post Verify Panel").setEmoji("🛡️").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("setup_post_tickets").setLabel("Post Ticket Panel").setEmoji("🎫").setStyle(ButtonStyle.Success)
        )
    ];
}

function buildChannelsMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ch_log").setLabel("Main Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_verifylog").setLabel("Verify Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_transcript").setLabel("Transcripts").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_welcome").setLabel("Welcome").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_suggestions").setLabel("Suggestions").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ch_stafffb").setLabel("Staff FB").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_stafflog").setLabel("Staff Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_hrlog").setLabel("HR Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_verifypanel").setLabel("Verify Ch").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_ticketlog").setLabel("Ticket Log").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
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
            new ButtonBuilder().setCustomId("setup_role_management").setLabel("Management").setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_role_exempt").setLabel("Exempt").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_verify").setLabel("Verify Role").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_accept").setLabel("Accept").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_clear_staff").setLabel("Clear Staff").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_clear_admin").setLabel("Clear Admin").setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_clear_highrank").setLabel("Clear HR").setStyle(ButtonStyle.Danger),
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
            new ButtonBuilder().setCustomId("setup_ticket_support_cat").setLabel("Support Category").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ticket_support_ping").setLabel("Support Ping").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ticket_high_cat").setLabel("High Rank Category").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ticket_high_ping").setLabel("High Rank Ping").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ticket_ping_management").setLabel("Auto-Ping Management").setEmoji("🛠️").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildTemplatesMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_tpl_accept").setLabel("Accept DM").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_tpl_promote").setLabel("Promote DM").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_tpl_demote").setLabel("Demote DM").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_tpl_infract").setLabel("Infract DM").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
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

const PERM_GROUPS = {
    setup: { name: "⚙️ Setup & Config", commands: ["setup", "setprefix", "setupverify", "setuptickets", "set-webhook", "remove-webhook", "antinuke"] },
    hr:    { name: "👑 HR / Applications", commands: ["acceptsetup", "accept", "promote", "demote", "infract"] },
    mod:   { name: "🔨 Moderation & Utility", commands: ["mute", "unmute", "warn", "kick", "ban", "unban", "roles"] },
    logs:  { name: "📝 Logging", commands: ["loguser"] },
    public:{ name: "🌐 Public & Fun", commands: ["suggest", "staff-feedback", "help", "serverinfo", "afk", "av"] }
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
            new ButtonBuilder().setCustomId("setup_perms_group_public").setLabel("Public").setEmoji("🌐").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_perms_reset").setLabel("Reset All").setEmoji("♻️").setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
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

const TIER_LABEL = {
    staff: "🎭 Staff", admin: "🔨 Admin", highrank: "⭐ High Rank",
    management: "🛡️ Management", everyone: "🌐 Everyone"
};
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
            .setDescription("Hierarchy: 🛡️ Management → ⭐ High Rank → 🔨 Admin → 🎭 Staff\n\nSet the roles for each tier.")
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
            .setDescription("Vars: `{server}` `{rank}` `{type}` `{reason}` `{notes}`\n\n**Accept:**\n" + gc.dmTemplates.accept +
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
    await interaction.update({ embeds: [embed], components: rows });
}

// ==========================================
// NEW COMMAND IMPLEMENTATIONS
// ==========================================

async function cmdRoles(interactionOrMessage, isSlash) {
    const guild = interactionOrMessage.guild;
    const roles = [...guild.roles.cache.values()].filter(r => r.id !== guild.id).sort((a, b) => b.position - a.position);

    const lines = roles.map(r => {
        const count = guild.members.cache.filter(m => m.roles.cache.has(r.id)).size;
        return r.toString() + " — `" + r.members.size + " members` — position " + r.position;
    });

    // Split into chunks if long
    const chunks = [];
    let current = "";
    for (const l of lines) {
        if ((current + "\n" + l).length > 3800) { chunks.push(current); current = l; }
        else current += (current ? "\n" : "") + l;
    }
    if (current) chunks.push(current);

    const embed = new EmbedBuilder()
        .setTitle("📋 Server Roles — " + roles.length + " total")
        .setColor(WEBHOOK_COLOR)
        .setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined })
        .setTimestamp();

    const totalMembers = guild.memberCount;
    embed.setDescription("**Total members:** " + totalMembers + "\n\n" + (chunks[0] || "None"));

    if (isSlash) await interactionOrMessage.reply({ embeds: [embed] });
    else await interactionOrMessage.reply({ embeds: [embed] });
}

async function cmdServerInfo(interactionOrMessage, isSlash) {
    const guild = interactionOrMessage.guild;
    await guild.members.fetch().catch(() => {});
    const owner = await guild.fetchOwner().catch(() => null);

    const textChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildText).size;
    const voiceChannels = guild.channels.cache.filter(c => c.type === ChannelType.GuildVoice).size;
    const categories = guild.channels.cache.filter(c => c.type === ChannelType.GuildCategory).size;

    const online = guild.members.cache.filter(m => m.presence?.status && m.presence.status !== "offline").size;
    const humans = guild.members.cache.filter(m => !m.user.bot).size;
    const bots = guild.members.cache.filter(m => m.user.bot).size;

    const embed = new EmbedBuilder()
        .setTitle("ℹ️ " + guild.name)
        .setThumbnail(guild.iconURL({ size: 256 }) || null)
        .setColor(WEBHOOK_COLOR)
        .addFields(
            { name: "Owner", value: owner ? owner.toString() : "Unknown", inline: true },
            { name: "Server ID", value: guild.id, inline: true },
            { name: "Created", value: "<t:" + ((guild.createdTimestamp / 1000) | 0) + ":F>\n(<t:" + ((guild.createdTimestamp / 1000) | 0) + ":R>)", inline: true },
            { name: "Members", value: String(guild.memberCount), inline: true },
            { name: "Humans / Bots", value: humans + " / " + bots, inline: true },
            { name: "Online", value: String(online), inline: true },
            { name: "Roles", value: String(guild.roles.cache.size - 1), inline: true },
            { name: "Channels", value: textChannels + " text • " + voiceChannels + " voice • " + categories + " categories", inline: true },
            { name: "Boost Tier", value: "Tier " + guild.premiumTier, inline: true },
            { name: "Boosts", value: String(guild.premiumSubscriptionCount || 0), inline: true },
            { name: "Emojis", value: String(guild.emojis.cache.size), inline: true },
            { name: "Verification Level", value: String(guild.verificationLevel), inline: true }
        )
        .setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined })
        .setTimestamp();

    if (guild.bannerURL()) embed.setImage(guild.bannerURL({ size: 1024 }));

    if (isSlash) await interactionOrMessage.reply({ embeds: [embed] });
    else await interactionOrMessage.reply({ embeds: [embed] });
}

async function cmdAfk(interactionOrMessage, isSlash, reason) {
    const guild = interactionOrMessage.guild;
    const user = isSlash ? interactionOrMessage.user : interactionOrMessage.author;
    const member = isSlash ? interactionOrMessage.member : interactionOrMessage.member;
    const gc = getGuildConfig(guild.id);

    const trimmed = (reason || "AFK").slice(0, 200);
    const already = gc.afk[user.id];

    gc.afk[user.id] = { reason: trimmed, since: already ? already.since : Date.now() };
    saveConfig();

    const embed = new EmbedBuilder()
        .setDescription("💤 **" + member.displayName + "** is now AFK: **" + trimmed + "**\n\n_I'll notify anyone who pings you. Send any message to clear._")
        .setColor(0xFEE75C)
        .setTimestamp();

    if (isSlash) await interactionOrMessage.reply({ embeds: [embed] });
    else await interactionOrMessage.reply({ embeds: [embed] });
}

async function cmdAv(interactionOrMessage, isSlash, targetUser) {
    const user = targetUser || (isSlash ? interactionOrMessage.user : interactionOrMessage.author);

    const embed = new EmbedBuilder()
        .setTitle(user.username + "'s Avatar")
        .setColor(WEBHOOK_COLOR)
        .setImage(user.displayAvatarURL({ size: 1024, extension: "png" }))
        .addFields(
            { name: "Username", value: user.tag, inline: true },
            { name: "ID", value: user.id, inline: true }
        )
        .setFooter({ text: "Requested by " + (isSlash ? interactionOrMessage.user.tag : interactionOrMessage.author.tag) })
        .setTimestamp();

    if (isSlash) await interactionOrMessage.reply({ embeds: [embed] });
    else await interactionOrMessage.reply({ embeds: [embed] });
}

// ==========================================
// INTERACTION HANDLER
// ==========================================

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isButton()) return handleButton(interaction);
        if (interaction.isModalSubmit()) return handleModal(interaction);
        if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu() || interaction.isUserSelectMenu()) {
            return handleSelect(interaction);
        }
        if (!interaction.isChatInputCommand()) return;
        const guild = interaction.guild;
        if (!guild) return;
        const gc = getGuildConfig(guild.id);
        const command = interaction.commandName;

        if (!canRunCommand(interaction.member, command)) {
            const required = getRequiredTiers(guild.id, command);
            return interaction.reply({ embeds: [errorEmbed("You don't have permission to use this command.\n**Required:** " + fmtTiers(required))], ephemeral: true });
        }

        // ---------- /setup ----------
        if (command === "setup") return interaction.reply({ embeds: [buildSetupEmbed(guild)], components: buildSetupRows(), ephemeral: true });

        // ---------- /setprefix ----------
        if (command === "setprefix") {
            const prefix = interaction.options.getString("prefix");
            if (/\s/.test(prefix)) return interaction.reply({ embeds: [errorEmbed("No spaces.")], ephemeral: true });
            gc.prefix = prefix; saveConfig();
            return interaction.reply({ embeds: [successEmbed("Prefix: `" + prefix + "`.")] });
        }

        // ---------- /setupverify ----------
        if (command === "setupverify") {
            gc.verifyChannelId = interaction.channel.id; saveConfig();
            await interaction.channel.send({ embeds: [buildVerifyEmbed(guild)], components: buildVerifyRows() });
            return interaction.reply({ embeds: [successEmbed("Verification panel posted.")], ephemeral: true });
        }

        // ---------- /setuptickets ----------
        if (command === "setuptickets") {
            await interaction.channel.send({ embeds: [buildTicketPanelEmbed(guild)], components: buildTicketPanelRows() });
            return interaction.reply({ embeds: [successEmbed("Ticket panel posted.")], ephemeral: true });
        }

        // ---------- Webhook ----------
        if (command === "set-webhook") {
            const url = interaction.options.getString("url");
            if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(url)) return interaction.reply({ embeds: [errorEmbed("Invalid URL.")], ephemeral: true });
            gc.webhookUrl = url; saveConfig();
            return interaction.reply({ embeds: [successEmbed("Webhook set.")] });
        }
        if (command === "remove-webhook") { gc.webhookUrl = null; saveConfig(); return interaction.reply({ embeds: [successEmbed("Removed.")] }); }

        // ---------- /acceptsetup ----------
        if (command === "acceptsetup") {
            const sub = interaction.options.getSubcommand();
            if (sub === "add")    { const r = interaction.options.getRole("role"); if (!gc.acceptRoleIds.includes(r.id)) gc.acceptRoleIds.push(r.id); saveConfig(); return interaction.reply({ embeds: [successEmbed(r + " added.")] }); }
            if (sub === "remove") { const r = interaction.options.getRole("role"); gc.acceptRoleIds = gc.acceptRoleIds.filter(id => id !== r.id); saveConfig(); return interaction.reply({ embeds: [successEmbed("Removed.")] }); }
            if (sub === "list")   return interaction.reply({ embeds: [infoEmbed("**Accept Roles:** " + fmtRoleList(gc.acceptRoleIds))], ephemeral: true });
            if (sub === "clear")  { gc.acceptRoleIds = []; saveConfig(); return interaction.reply({ embeds: [successEmbed("Cleared.")] }); }
        }

        // ---------- /antinuke ----------
        if (command === "antinuke") {
            const sub = interaction.options.getSubcommand();
            const an = gc.antinuke;
            if (sub === "status") {
                const watchCount = Object.values(an.watchlist).filter(e => e > Date.now()).length;
                return interaction.reply({ embeds: [new EmbedBuilder().setTitle("🛡️ Anti-Nuke Status").setColor(WEBHOOK_COLOR)
                    .addFields(
                        { name: "Enabled", value: an.enabled ? "✅" : "❌", inline: true },
                        { name: "Threshold", value: String(an.threshold), inline: true },
                        { name: "Window", value: (an.windowMs / 1000) + "s", inline: true },
                        { name: "Whitelist", value: an.whitelist.length ? an.whitelist.map(id => "<@" + id + ">").join(", ") : "None", inline: false },
                        { name: "On Watch", value: String(watchCount), inline: true }
                    )], ephemeral: true });
            }
            if (sub === "enable")          { an.enabled = true; saveConfig();  return interaction.reply({ embeds: [successEmbed("Enabled.")] }); }
            if (sub === "disable")         { an.enabled = false; saveConfig(); return interaction.reply({ embeds: [successEmbed("Disabled.")] }); }
            if (sub === "threshold")       { const n = interaction.options.getInteger("count"); an.threshold = n; saveConfig(); return interaction.reply({ embeds: [successEmbed("Threshold: **" + n + "**.")] }); }
            if (sub === "whitelist-add")   { const u = interaction.options.getUser("user"); if (!an.whitelist.includes(u.id)) an.whitelist.push(u.id); saveConfig(); return interaction.reply({ embeds: [successEmbed(u.tag + " whitelisted.")] }); }
            if (sub === "whitelist-remove"){ const u = interaction.options.getUser("user"); an.whitelist = an.whitelist.filter(id => id !== u.id); saveConfig(); return interaction.reply({ embeds: [successEmbed("Removed.")] }); }
            if (sub === "whitelist-list")  { const list = an.whitelist.length ? an.whitelist.map(id => "<@" + id + ">").join(", ") : "None"; return interaction.reply({ embeds: [infoEmbed("**Whitelisted:** " + list)], ephemeral: true }); }
            if (sub === "watchlist") {
                const now = Date.now();
                const entries = Object.entries(an.watchlist).filter(([, e]) => e > now);
                if (!entries.length) return interaction.reply({ embeds: [infoEmbed("No users on watch.")], ephemeral: true });
                return interaction.reply({ embeds: [infoEmbed("**Watch:**\n" + entries.map(([uid, e]) => "• <@" + uid + "> — <t:" + ((e / 1000) | 0) + ":R>").join("\n"))], ephemeral: true });
            }
            if (sub === "unwatch") { const u = interaction.options.getUser("user"); delete an.watchlist[u.id]; saveConfig(); return interaction.reply({ embeds: [successEmbed("Unwatched.")] }); }
            if (sub === "reset")   { an.counters = {}; saveConfig(); return interaction.reply({ embeds: [successEmbed("Reset.")] }); }
        }

        // ---------- HR ----------
        if (command === "accept") {
            const targetUser = interaction.options.getUser("user");
            const notes = interaction.options.getString("notes") || null;
            await interaction.deferReply();
            let roleGiven = 0;
            if (gc.acceptRoleIds.length) {
                const member = await guild.members.fetch(targetUser.id).catch(() => null);
                if (member) for (const rid of gc.acceptRoleIds) { try { await member.roles.add(rid, "Accepted"); roleGiven++; } catch {} }
            }
            const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "accept", { notes: notes || "" }));
            const embed = new EmbedBuilder().setTitle("Application Accepted").setColor(0x57F287)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "By", value: interaction.user.tag, inline: true },
                    { name: "Roles", value: String(roleGiven), inline: true },
                    { name: "DM", value: dmSent ? "Yes" : "No", inline: true }
                ).setTimestamp();
            if (notes) embed.addFields({ name: "Notes", value: notes.slice(0, 1024) });
            await broadcast(guild, embed, ["hr", "log", "webhook"]);
            return interaction.editReply({ embeds: [successEmbed(targetUser.tag + " accepted.")] });
        }
        if (command === "promote" || command === "demote" || command === "infract") {
            const targetUser = interaction.options.getUser("user");
            const notes = interaction.options.getString("notes") || null;
            await interaction.deferReply();

            let rank = null, type = null, reason = null, tplKey = command;
            if (command !== "infract") rank = interaction.options.getString("rank");
            else { type = interaction.options.getString("type"); reason = interaction.options.getString("reason"); }

            const dmSent = await tryDM(targetUser, buildTemplateDM(guild, tplKey, { rank, type, reason, notes: notes || "" }));

            const colorMap = { promote: 0x57F287, demote: 0xED4245, infract: { warn: 0xFEE75C, strike: 0xED4245, demotion: 0xED4245, suspension: 0x992D22 } };
            const titleMap = { promote: "Promotion", demote: "Demotion", infract: "Infraction" };
            const finalColor = command === "infract" ? (colorMap.infract[type] || 0xED4245) : colorMap[command];

            const embed = new EmbedBuilder().setTitle(titleMap[command]).setColor(finalColor)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    command === "infract" ? { name: "Type", value: type, inline: true } : { name: "New Rank", value: rank, inline: true },
                    { name: "By", value: interaction.user.tag, inline: true },
                    { name: "DM", value: dmSent ? "Yes" : "No", inline: true }
                ).setTimestamp();
            if (command === "infract") embed.addFields({ name: "Reason", value: reason, inline: false });
            if (notes) embed.addFields({ name: "Notes", value: notes.slice(0, 1024) });

            await broadcast(guild, embed, ["hr", "log", "webhook"]);
            return interaction.editReply({ embeds: [successEmbed(targetUser.tag + " " + tplKey + "d.")] });
        }

        // ---------- Moderation ----------
        if (command === "mute") {
            const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [errorEmbed("Not found.")], ephemeral: true });
            if (isExempt(target)) return interaction.reply({ embeds: [errorEmbed("Exempt.")], ephemeral: true });
            if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [errorEmbed("Hierarchy.")], ephemeral: true });
            const durationInput = interaction.options.getString("duration");
            const duration = parseDuration(durationInput);
            if (!duration) return interaction.reply({ embeds: [errorEmbed("Invalid duration.")], ephemeral: true });
            const limit = getLimitData(guild.id, interaction.user.id);
            if (limit.mutes >= DAILY_LIMIT) return interaction.reply({ embeds: [errorEmbed("Daily limit.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            await interaction.deferReply();
            try {
                await target.timeout(duration, reason);
                limit.mutes++; saveConfig();
                const embed = logEmbed("Member Muted", "**User:** " + target + "\n**Mod:** " + interaction.user + "\n**Duration:** " + durationInput + "\n**Reason:** " + reason);
                await broadcast(guild, embed, ["log", "staff", "webhook"]);
                return interaction.editReply({ embeds: [successEmbed(target + " muted.")] });
            } catch { return interaction.editReply({ embeds: [errorEmbed("Failed.")] }); }
        }
        if (command === "unmute") {
            const t = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
            if (!t) return interaction.reply({ embeds: [errorEmbed("Not found.")], ephemeral: true });
            await interaction.deferReply();
            try {
                await t.timeout(null, interaction.options.getString("reason") || "No reason provided");
                const embed = logEmbed("Member Unmuted", "**User:** " + t + "\n**Mod:** " + interaction.user);
                await broadcast(guild, embed, ["log", "staff", "webhook"]);
                return interaction.editReply({ embeds: [successEmbed("Unmuted.")] });
            } catch { return interaction.editReply({ embeds: [errorEmbed("Failed.")] }); }
        }
        if (command === "warn") {
            const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [errorEmbed("Not found.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            await interaction.deferReply();
            const embed = logEmbed("Member Warned", "**User:** " + target + "\n**Mod:** " + interaction.user + "\n**Reason:** " + reason, 0xFEE75C);
            await Promise.all([
                broadcast(guild, embed, ["log", "staff", "webhook"]),
                target.send({ embeds: [logEmbed("You were warned in " + guild.name, "**Reason:** " + reason, 0xFEE75C)] }).catch(() => {})
            ]);
            return interaction.editReply({ embeds: [successEmbed(target + " warned.")] });
        }
        if (command === "kick") {
            const t = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
            if (!t) return interaction.reply({ embeds: [errorEmbed("Not found.")], ephemeral: true });
            if (isExempt(t)) return interaction.reply({ embeds: [errorEmbed("Exempt.")], ephemeral: true });
            if (!canModerate(interaction.member, t)) return interaction.reply({ embeds: [errorEmbed("Hierarchy.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            await interaction.deferReply();
            try {
                await t.kick(reason);
                const embed = logEmbed("Member Kicked", "**User:** " + t.user.tag + "\n**Mod:** " + interaction.user + "\n**Reason:** " + reason);
                await broadcast(guild, embed, ["log", "staff", "webhook"]);
                return interaction.editReply({ embeds: [successEmbed("Kicked.")] });
            } catch { return interaction.editReply({ embeds: [errorEmbed("Failed.")] }); }
        }
        if (command === "ban") {
            const t = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
            if (!t) return interaction.reply({ embeds: [errorEmbed("Not found.")], ephemeral: true });
            if (isExempt(t)) return interaction.reply({ embeds: [errorEmbed("Exempt.")], ephemeral: true });
            if (!canModerate(interaction.member, t)) return interaction.reply({ embeds: [errorEmbed("Hierarchy.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            await interaction.deferReply();
            try {
                await t.ban({ reason });
                const embed = logEmbed("Member Banned", "**User:** " + t.user.tag + "\n**Mod:** " + interaction.user + "\n**Reason:** " + reason);
                await broadcast(guild, embed, ["log", "staff", "webhook"]);
                return interaction.editReply({ embeds: [successEmbed("Banned.")] });
            } catch { return interaction.editReply({ embeds: [errorEmbed("Failed.")] }); }
        }
        if (command === "unban") {
            const userId = interaction.options.getString("userid");
            const reason = interaction.options.getString("reason") || "No reason provided";
            await interaction.deferReply();
            try {
                const u = await client.users.fetch(userId);
                await guild.members.unban(userId, reason);
                const embed = logEmbed("Member Unbanned", "**User:** " + u.tag + "\n**Mod:** " + interaction.user + "\n**Reason:** " + reason);
                await broadcast(guild, embed, ["log", "staff", "webhook"]);
                return interaction.editReply({ embeds: [successEmbed("Unbanned.")] });
            } catch { return interaction.editReply({ embeds: [errorEmbed("Failed.")] }); }
        }

        // ---------- /loguser ----------
        if (command === "loguser") {
            const username = interaction.options.getString("username");
            const punishment = interaction.options.getString("punishment");
            const reason = interaction.options.getString("reason");
            const notes = interaction.options.getString("notes") || null;

            await interaction.deferReply();
            const robloxData = await lookupRobloxUser(username);

            const meta = {
                warn: { label: "Warn", emoji: "⚠️", color: 0xFEE75C },
                kick: { label: "Kick", emoji: "👢", color: 0xE67E22 },
                ban:  { label: "Ban",  emoji: "🔨", color: 0xED4245 }
            }[punishment];

            const embed = new EmbedBuilder()
                .setTitle(meta.emoji + " " + meta.label + " Logged")
                .setColor(meta.color)
                .addFields(
                    { name: "Roblox Username", value: robloxData ? robloxData.username : username, inline: true },
                    { name: "Roblox ID", value: robloxData ? String(robloxData.id) : "Not found", inline: true },
                    { name: "Display Name", value: robloxData ? robloxData.displayName : "N/A", inline: true },
                    { name: "Punishment", value: meta.label, inline: true },
                    { name: "Moderator", value: interaction.user.tag, inline: true },
                    { name: "Reason", value: reason, inline: false }
                )
                .setFooter({ text: "Logged by " + interaction.user.tag })
                .setTimestamp();
            if (robloxData?.avatarUrl) embed.setThumbnail(robloxData.avatarUrl);
            if (robloxData) embed.addFields({ name: "Profile", value: "[View](" + robloxData.profileUrl + ")", inline: false });
            if (notes) embed.addFields({ name: "Notes", value: notes.slice(0, 1024) });

            await broadcast(guild, embed, ["staff", "log", "webhook"]);
            return interaction.editReply({ embeds: [successEmbed("**" + meta.label + "** logged for **" + (robloxData?.username || username) + "**.")] });
        }

        // ---------- NEW UTILITY ----------
        if (command === "roles")     return cmdRoles(interaction, true);
        if (command === "serverinfo") return cmdServerInfo(interaction, true);
        if (command === "afk")       return cmdAfk(interaction, true, interaction.options.getString("reason"));
        if (command === "av")        return cmdAv(interaction, true, interaction.options.getUser("user"));

        // ---------- Public ----------
        if (command === "suggest") {
            if (!gc.suggestionChannelId) return interaction.reply({ embeds: [errorEmbed("Suggestions channel not set.")], ephemeral: true });
            const suggestion = interaction.options.getString("suggestion");
            const ch = guild.channels.cache.get(gc.suggestionChannelId);
            if (!ch) return interaction.reply({ embeds: [errorEmbed("Not found.")], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const sent = await ch.send({ embeds: [buildSuggestionEmbed(suggestion, interaction.user, 0, 0)], components: [buildVoteRow("pending", "suggestion")] });
            await sent.edit({ embeds: [buildSuggestionEmbed(suggestion, interaction.user, 0, 0)], components: [buildVoteRow(sent.id, "suggestion")] });
            gc.suggestions[sent.id] = { authorId: interaction.user.id, content: suggestion, upvotes: [], downvotes: [], createdAt: Date.now() };
            saveConfig();
            return interaction.editReply({ embeds: [successEmbed("Submitted!")] });
        }
        if (command === "staff-feedback") {
            if (!gc.staffFeedbackChannelId) return interaction.reply({ embeds: [errorEmbed("Staff feedback channel not set.")], ephemeral: true });
            const staffMember = interaction.options.getUser("staff");
            const feedback = interaction.options.getString("feedback");
            const ch = guild.channels.cache.get(gc.staffFeedbackChannelId);
            if (!ch) return interaction.reply({ embeds: [errorEmbed("Not found.")], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const sent = await ch.send({ embeds: [buildStaffFeedbackEmbed(staffMember, feedback, interaction.user, 0, 0)], components: [buildVoteRow("pending", "feedback")] });
            await sent.edit({ embeds: [buildStaffFeedbackEmbed(staffMember, feedback, interaction.user, 0, 0)], components: [buildVoteRow(sent.id, "feedback")] });
            gc.staffFeedback[sent.id] = { authorId: interaction.user.id, staffId: staffMember.id, content: feedback, upvotes: [], downvotes: [], createdAt: Date.now() };
            saveConfig();
            return interaction.editReply({ embeds: [successEmbed("Submitted!")] });
        }

        if (command === "help") {
            const prefix = getPrefix(guild.id);
            const embed = new EmbedBuilder().setTitle(guild.name + " — Bot Commands V.1.8")
                .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL())
                .addFields(
                    { name: "Setup (Management)", value: "`/setup` `/setupverify` `/setuptickets`", inline: false },
                    { name: "Anti-Nuke (Management)", value: "`/antinuke status|enable|disable`\n`/antinuke threshold <n>`\n`/antinuke whitelist-add|remove|list`\n`/antinuke watchlist`", inline: false },
                    { name: "HR", value: "`/accept` `/promote` `/demote` `/infract`", inline: false },
                    { name: "Moderation", value: "`/mute` `/unmute` `/warn` `/kick` `/ban` `/unban`", inline: false },
                    { name: "Logging", value: "`/loguser <user> <Warn|Kick|Ban> <reason>`\n`" + prefix + "loguser`", inline: false },
                    { name: "Utility", value: "`/roles` (staff) `/serverinfo` `/av [user]` `/afk [reason]`", inline: false },
                    { name: "Public", value: "`/suggest` `/staff-feedback`", inline: false },
                    { name: "Prefix", value: "`" + prefix + "roles` `/serverinfo` `/av` `/afk` — plus `" + prefix + "loguser`, `" + prefix + "help`", inline: false }
                );
            return interaction.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error("interaction:", error);
        try {
            if (interaction.replied || interaction.deferred) await interaction.followUp({ embeds: [errorEmbed("An error occurred.")], ephemeral: true });
            else await interaction.reply({ embeds: [errorEmbed("An error occurred.")], ephemeral: true });
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

    if (id === "setup_back")          return updateSetupMessage(interaction, "main");
    if (id === "setup_channels")      return updateSetupMessage(interaction, "channels");
    if (id === "setup_roles")         return updateSetupMessage(interaction, "roles");
    if (id === "setup_tickets")       return updateSetupMessage(interaction, "tickets");
    if (id === "setup_dm_templates")  return updateSetupMessage(interaction, "templates");
    if (id === "setup_antinuke")      return updateSetupMessage(interaction, "antinuke");
    if (id === "setup_perms")         return showPermsOverview(interaction);

    if (id.startsWith("setup_perms_group_")) {
        const groupKey = id.slice(18);
        const group = PERM_GROUPS[groupKey];
        if (!group) return;
        const lines = group.commands.map(c => "`/" + c + "` → " + fmtTiers(getRequiredTiers(guild.id, c)));
        const embed = new EmbedBuilder().setTitle("🔐 " + group.name)
            .setDescription("**Current:**\n" + lines.join("\n"))
            .setColor(WEBHOOK_COLOR).setTimestamp();
        return interaction.update({ embeds: [embed], components: buildPermsGroupRows(groupKey) });
    }

    if (id.startsWith("setup_perm_edit_")) {
        const cmd = id.slice(17);
        const tiers = getRequiredTiers(guild.id, cmd);
        const embed = new EmbedBuilder().setTitle("🔐 Edit `/" + cmd + "`")
            .setDescription("**Current:** " + fmtTiers(tiers))
            .setColor(WEBHOOK_COLOR).setTimestamp();
        return interaction.update({ embeds: [embed], components: permToggleRows(cmd, tiers) });
    }

    if (id.startsWith("setup_perm_toggle_")) {
        const rest = id.slice(19);
        const idx = rest.lastIndexOf("_");
        const cmd = rest.slice(0, idx);
        const tierKey = rest.slice(idx + 1);
        if (!gc.commandPerms[cmd]) gc.commandPerms[cmd] = [...(DEFAULT_COMMAND_PERMS[cmd] || ["management"])];
        const cur = gc.commandPerms[cmd];
        gc.commandPerms[cmd] = cur.includes(tierKey) ? cur.filter(t => t !== tierKey) : [...cur, tierKey];
        saveConfig();
        const newTiers = gc.commandPerms[cmd];
        const embed = new EmbedBuilder().setTitle("🔐 Edit `/" + cmd + "`")
            .setDescription("**Current:** " + fmtTiers(newTiers))
            .setColor(WEBHOOK_COLOR).setTimestamp();
        return interaction.update({ embeds: [embed], components: permToggleRows(cmd, newTiers) });
    }

    if (id.startsWith("setup_perm_reset_")) {
        const cmd = id.slice(18);
        delete gc.commandPerms[cmd];
        saveConfig();
        const tiers = getRequiredTiers(guild.id, cmd);
        const embed = new EmbedBuilder().setTitle("🔐 Edit `/" + cmd + "`")
            .setDescription("**Reset to default.** Current: " + fmtTiers(tiers))
            .setColor(WEBHOOK_COLOR).setTimestamp();
        return interaction.update({ embeds: [embed], components: permToggleRows(cmd, tiers) });
    }

    if (id === "setup_perms_reset") { gc.commandPerms = {}; saveConfig(); return showPermsOverview(interaction); }

    if (id === "setup_prefix") {
        const modal = new ModalBuilder().setCustomId("modal_prefix").setTitle("Set Prefix");
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("prefix").setLabel("New prefix (max 5 chars)").setStyle(TextInputStyle.Short).setMaxLength(5).setRequired(true)
        ));
        return interaction.showModal(modal);
    }
    if (id === "setup_webhook") {
        const modal = new ModalBuilder().setCustomId("modal_webhook").setTitle("Set Webhook URL");
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("url").setLabel("Discord webhook URL").setStyle(TextInputStyle.Short).setRequired(true)
        ));
        return interaction.showModal(modal);
    }

    const channelMap = {
        setup_ch_log: { key: "logChannelId", name: "Main Log" },
        setup_ch_verifylog: { key: "verificationLogChannelId", name: "Verification Log" },
        setup_ch_transcript: { key: "transcriptChannelId", name: "Ticket Transcripts" },
        setup_ch_welcome: { key: "welcomeChannelId", name: "Welcome" },
        setup_ch_suggestions: { key: "suggestionChannelId", name: "Suggestions" },
        setup_ch_stafffb: { key: "staffFeedbackChannelId", name: "Staff Feedback" },
        setup_ch_stafflog: { key: "staffLogChannelId", name: "Staff Log" },
        setup_ch_hrlog: { key: "hrLogChannelId", name: "HR Log" },
        setup_ch_verifypanel: { key: "verifyChannelId", name: "Verify Panel Channel" },
        setup_ch_ticketlog: { key: "ticketLogChannelId", name: "Ticket Log" }
    };
    if (channelMap[id]) {
        const cfg = channelMap[id];
        return interaction.update({
            embeds: [infoEmbed("Choose a channel for **" + cfg.name + "**:")],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId("select_channel_" + cfg.key).setPlaceholder("Pick a channel").setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
            )]
        });
    }

    const roleMap = {
        setup_role_staff: { key: "staffRoles", name: "Staff", single: false },
        setup_role_admin: { key: "adminRoles", name: "Admin", single: false },
        setup_role_highrank: { key: "highRankRoles", name: "High Rank", single: false },
        setup_role_management: { key: "managementRoles", name: "Management", single: false },
        setup_role_exempt: { key: "exemptRoles", name: "Exempt", single: false },
        setup_role_verify: { key: "verifyRoleId", name: "Verify Role", single: true },
        setup_role_accept: { key: "acceptRoleIds", name: "Accept", single: false }
    };
    if (roleMap[id]) {
        const cfg = roleMap[id];
        return interaction.update({
            embeds: [infoEmbed("Choose roles for **" + cfg.name + "**:")],
            components: [new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder().setCustomId("select_role_" + cfg.key).setPlaceholder("Pick roles").setMaxValues(cfg.single ? 1 : 10)
            )]
        });
    }

    if (id === "setup_clear_staff")      { gc.staffRoles = [];      saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_admin")      { gc.adminRoles = [];      saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_highrank")   { gc.highRankRoles = [];   saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_management") { gc.managementRoles = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_exempt")     { gc.exemptRoles = [];     saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_accept")     { gc.acceptRoleIds = [];   saveConfig(); return updateSetupMessage(interaction, "roles"); }

    if (id === "setup_ticket_support_cat")  return interaction.update({ embeds: [infoEmbed("Choose the **Support Tickets Category**:")],  components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("select_ticketcat_support").setPlaceholder("Pick a category").setChannelTypes([ChannelType.GuildCategory]))] });
    if (id === "setup_ticket_high_cat")     return interaction.update({ embeds: [infoEmbed("Choose the **High Rank Tickets Category**:")], components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("select_ticketcat_highrank").setPlaceholder("Pick a category").setChannelTypes([ChannelType.GuildCategory]))] });
    if (id === "setup_ticket_support_ping") return interaction.update({ embeds: [infoEmbed("Choose the **Support Ping Role**:")],  components: [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId("select_ticketping_support").setPlaceholder("Pick a role").setMaxValues(1))] });
    if (id === "setup_ticket_high_ping")    return interaction.update({ embeds: [infoEmbed("Choose the **High Rank Ping Role**:")], components: [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId("select_ticketping_highrank").setPlaceholder("Pick a role").setMaxValues(1))] });
    if (id === "setup_ticket_ping_management") {
        if (!gc.managementRoles.length) return interaction.reply({ embeds: [errorEmbed("Set Management roles first.")], ephemeral: true });
        gc.ticketHighRankPingRoleId = gc.managementRoles[0]; saveConfig();
        return updateSetupMessage(interaction, "tickets");
    }

    if (id === "setup_an_toggle")    { gc.antinuke.enabled = !gc.antinuke.enabled; saveConfig(); return updateSetupMessage(interaction, "antinuke"); }
    if (id === "setup_an_threshold") {
        const modal = new ModalBuilder().setCustomId("modal_an_threshold").setTitle("Set Anti-Nuke Threshold");
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("threshold").setLabel("Trigger after N events (2-20)").setStyle(TextInputStyle.Short).setValue(String(gc.antinuke.threshold)).setRequired(true)
        ));
        return interaction.showModal(modal);
    }
    if (id === "setup_an_whitelist")   return interaction.update({ embeds: [infoEmbed("Choose a user to **whitelist**:")],   components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("select_an_whitelist_add").setPlaceholder("Pick a user").setMaxValues(1))] });
    if (id === "setup_an_unwhitelist") return interaction.update({ embeds: [infoEmbed("Choose a user to **unwhitelist**:")], components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("select_an_whitelist_remove").setPlaceholder("Pick a user").setMaxValues(1))] });
    if (id === "setup_an_list") {
        const list = gc.antinuke.whitelist.length ? gc.antinuke.whitelist.map(id => "<@" + id + ">").join(", ") : "None";
        return interaction.reply({ embeds: [infoEmbed("**Whitelisted:** " + list)], ephemeral: true });
    }
    if (id === "setup_an_watchlist") {
        const now = Date.now();
        const entries = Object.entries(gc.antinuke.watchlist).filter(([, e]) => e > now);
        if (!entries.length) return interaction.reply({ embeds: [infoEmbed("No users on rejoin watch.")], ephemeral: true });
        return interaction.reply({ embeds: [infoEmbed("**Watch:**\n" + entries.map(([uid, e]) => "• <@" + uid + "> — <t:" + ((e / 1000) | 0) + ":R>").join("\n"))], ephemeral: true });
    }
    if (id === "setup_an_reset") { gc.antinuke.counters = {}; saveConfig(); return updateSetupMessage(interaction, "antinuke"); }

    if (id === "setup_post_verify")  { await interaction.channel.send({ embeds: [buildVerifyEmbed(guild)], components: buildVerifyRows() }); return interaction.reply({ embeds: [successEmbed("Verification panel posted.")], ephemeral: true }); }
    if (id === "setup_post_tickets") { await interaction.channel.send({ embeds: [buildTicketPanelEmbed(guild)], components: buildTicketPanelRows() }); return interaction.reply({ embeds: [successEmbed("Ticket panel posted.")], ephemeral: true }); }

    const tplMap = {
        setup_tpl_accept:  { key: "accept",  name: "Accept DM",  label: "Vars: {server} {notes}" },
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

    if (id.startsWith("vote_"))            return handleVoteButton(interaction);
    if (id === "verify_start")             return handleVerifyStart(interaction);
    if (id === "verify_check")             return handleVerifyCheck(interaction);
    if (id === "verify_help")              return handleTicketCreate(interaction, "support", "User clicked **I Can't Verify** on the verification panel.");
    if (id === "ticket_open_menu")         return interaction.reply({ embeds: [infoEmbed("**Which support do you need?**")], components: buildTicketTypeRows(), ephemeral: true });
    if (id === "ticket_rules")             return interaction.reply({ embeds: [buildTicketRulesEmbed(guild)], ephemeral: true });
    if (id === "ticket_type_support")      return handleTicketCreate(interaction, "support");
    if (id === "ticket_type_highrank")     return handleTicketCreate(interaction, "highrank");
    if (id === "ticket_close")             return handleTicketClose(interaction);
}

// ==========================================
// SELECT HANDLER
// ==========================================

async function handleSelect(interaction) {
    const id = interaction.customId;
    const gc = getGuildConfig(interaction.guild.id);

    if (id.startsWith("select_channel_")) { gc[id.slice(15)] = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "channels"); }
    if (id.startsWith("select_role_")) {
        const key = id.slice(12);
        const values = interaction.values;
        if (key === "verifyRoleId") gc.verifyRoleId = values[0];
        else for (const rid of values) if (!gc[key].includes(rid)) gc[key].push(rid);
        saveConfig();
        return updateSetupMessage(interaction, "roles");
    }
    if (id === "select_ticketcat_support")  { gc.ticketSupportCategoryId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_ticketcat_highrank") { gc.ticketHighRankCategoryId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_ticketping_support")  { gc.ticketSupportPingRoleId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_ticketping_highrank") { gc.ticketHighRankPingRoleId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_an_whitelist_add")    { const uid = interaction.values[0]; if (!gc.antinuke.whitelist.includes(uid)) gc.antinuke.whitelist.push(uid); saveConfig(); return updateSetupMessage(interaction, "antinuke"); }
    if (id === "select_an_whitelist_remove") { const uid = interaction.values[0]; gc.antinuke.whitelist = gc.antinuke.whitelist.filter(x => x !== uid); saveConfig(); return updateSetupMessage(interaction, "antinuke"); }
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
        if (/\s/.test(prefix)) return interaction.reply({ embeds: [errorEmbed("No spaces.")], ephemeral: true });
        gc.prefix = prefix; saveConfig();
        return interaction.reply({ embeds: [successEmbed("Prefix: `" + prefix + "`.")], ephemeral: true });
    }
    if (id === "modal_webhook") {
        const url = interaction.fields.getTextInputValue("url");
        if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(url)) return interaction.reply({ embeds: [errorEmbed("Invalid URL.")], ephemeral: true });
        gc.webhookUrl = url; saveConfig();
        return interaction.reply({ embeds: [successEmbed("Webhook saved.")], ephemeral: true });
    }
    if (id.startsWith("modal_tpl_")) {
        const key = id.slice(10);
        const value = interaction.fields.getTextInputValue("template");
        gc.dmTemplates[key] = value; saveConfig();
        return interaction.reply({ embeds: [new EmbedBuilder().setTitle("✅ Template Updated: " + key).setDescription("**New template:**\n" + value).setColor(0x57F287).setTimestamp()], ephemeral: true });
    }
    if (id === "modal_an_threshold") {
        const raw = interaction.fields.getTextInputValue("threshold").trim();
        const n = parseInt(raw, 10);
        if (isNaN(n) || n < 2 || n > 20) return interaction.reply({ embeds: [errorEmbed("Enter 2-20.")], ephemeral: true });
        gc.antinuke.threshold = n; saveConfig();
        return interaction.reply({ embeds: [successEmbed("Threshold: **" + n + "**.")], ephemeral: true });
    }
    if (id === "modal_verify_username") {
        const username = interaction.fields.getTextInputValue("username").trim();
        const robloxData = await lookupRobloxUser(username);
        if (!robloxData) return interaction.reply({ embeds: [errorEmbed("Could not find Roblox username.")], ephemeral: true });
        const code = generateCode();
        gc.verifySessions[interaction.user.id] = { code, robloxId: robloxData.id, robloxUsername: robloxData.username, createdAt: Date.now() };
        saveConfig();
        const embed = new EmbedBuilder().setTitle("Verification Code")
            .setDescription("**Step 1:** Open your profile: [Click here](" + robloxData.profileUrl + ")\n**Step 2:** Paste this into your **About** and save:\n\n`" + code + "`\n\n**Step 3:** Return and click **Check Verification**.")
            .setColor(WEBHOOK_COLOR).setThumbnail(robloxData.avatarUrl || guild.iconURL()).setTimestamp();
        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

// ==========================================
// VERIFY
// ==========================================

async function handleVerifyStart(interaction) {
    const modal = new ModalBuilder().setCustomId("modal_verify_username").setTitle("Roblox Verification");
    modal.addComponents(new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId("username").setLabel("Your Roblox username").setStyle(TextInputStyle.Short).setRequired(true)
    ));
    return interaction.showModal(modal);
}

async function handleVerifyCheck(interaction) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    const session = gc.verifySessions[interaction.user.id];
    if (!session) return interaction.reply({ embeds: [errorEmbed("No active session.")], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const robloxData = await lookupRobloxUser(session.robloxUsername);
    if (!robloxData) return interaction.editReply({ embeds: [errorEmbed("Fetch failed.")] });
    if (!robloxData.description.includes(session.code)) return interaction.editReply({ embeds: [errorEmbed("Code not found in profile.")] });
    gc.verifiedUsers[interaction.user.id] = { robloxId: robloxData.id, robloxUsername: robloxData.username, verifiedAt: Date.now() };
    delete gc.verifySessions[interaction.user.id];
    saveConfig();
    let roleGiven = false;
    if (gc.verifyRoleId) { try { await interaction.member.roles.add(gc.verifyRoleId, "Verified"); roleGiven = true; } catch {} }

    const success = new EmbedBuilder().setTitle("✅ Verification Successful")
        .setDescription("Welcome, **" + robloxData.username + "**! You have been verified.")
        .setColor(0x57F287).setThumbnail(robloxData.avatarUrl || null).setTimestamp();

    const logE = new EmbedBuilder().setTitle("User Verified").setColor(WEBHOOK_COLOR)
        .addFields(
            { name: "Discord", value: interaction.user.tag + " (" + interaction.user.id + ")", inline: true },
            { name: "Roblox", value: robloxData.username + " (" + robloxData.id + ")", inline: true },
            { name: "Role Given", value: roleGiven ? "Yes" : "No", inline: true }
        ).setThumbnail(robloxData.avatarUrl || null).setTimestamp();

    await broadcast(guild, logE, ["verify", "log", "webhook"]);
    return interaction.editReply({ embeds: [success] });
}

// ==========================================
// TICKETS
// ==========================================

const TICKET_TYPES = {
    support:  { label: "General Support", slug: "general-support", emoji: "⚙️", categoryKey: "ticketSupportCategoryId",  pingKey: "ticketSupportPingRoleId" },
    highrank: { label: "High Rank",       slug: "high-rank",        emoji: "🛡️", categoryKey: "ticketHighRankCategoryId", pingKey: "ticketHighRankPingRoleId" }
};

async function handleTicketCreate(interaction, type, prefillReason) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    const cfg = TICKET_TYPES[type];
    if (!cfg) return interaction.reply({ embeds: [errorEmbed("Unknown ticket type.")], ephemeral: true });

    const existing = Object.entries(gc.tickets).find(([, t]) => t.userId === interaction.user.id && t.open);
    if (existing) {
        const ch = guild.channels.cache.get(existing[0]);
        return interaction.reply({ embeds: [errorEmbed(ch ? "You have an open ticket: " + ch : "You already have an open ticket.")], ephemeral: true });
    }
    const categoryId = gc[cfg.categoryKey];
    if (!categoryId) return interaction.reply({ embeds: [errorEmbed("Category not set. Configure in `/setup → Tickets`.")], ephemeral: true });
    const category = guild.channels.cache.get(categoryId) || await guild.channels.fetch(categoryId).catch(() => null);
    if (!category || category.type !== ChannelType.GuildCategory) return interaction.reply({ embeds: [errorEmbed("Category missing.")], ephemeral: true });

    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
    const ticketNumber = (gc.ticketCounter || 0) + 1;
    gc.ticketCounter = ticketNumber;
    const cleanUser = (interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "") || "user").slice(0, 15);
    const channelName = ticketNumber + "-" + cfg.slug + "-" + cleanUser;

    const overwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
    ];
    const viewRoleIds = new Set([...gc.staffRoles, ...gc.adminRoles, ...gc.highRankRoles, ...gc.managementRoles]);
    if (gc[cfg.pingKey]) viewRoleIds.add(gc[cfg.pingKey]);
    for (const rid of viewRoleIds) if (!overwrites.find(o => o.id === rid))
        overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    let channel;
    try {
        channel = await guild.channels.create({
            name: channelName, type: ChannelType.GuildText, parent: categoryId,
            permissionOverwrites: overwrites,
            topic: "Ticket #" + ticketNumber + " • " + cfg.label + " • " + interaction.user.tag
        });
    } catch (e) { console.error(e); return interaction.editReply({ embeds: [errorEmbed("Could not create.")] }); }

    gc.tickets[channel.id] = { userId: interaction.user.id, type, number: ticketNumber, name: cfg.slug, open: true, createdAt: Date.now() };
    saveConfig();

    const pingIds = new Set();
    if (gc[cfg.pingKey]) pingIds.add(gc[cfg.pingKey]);
    if (type === "highrank") for (const rid of gc.managementRoles) pingIds.add(rid);
    const pingStr = [...pingIds].map(id => "<@&" + id + ">").join(" ");

    const welcome = new EmbedBuilder()
        .setTitle(cfg.emoji + " " + cfg.label + " — Ticket #" + ticketNumber)
        .setDescription("**" + interaction.user + "**, thank you for opening a ticket.\n\n" + (prefillReason ? "**Reason:** " + prefillReason + "\n\n" : "") + "A staff member will assist you shortly.")
        .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL({ size: 256 }))
        .setFooter({ text: guild.name, iconURL: guild.iconURL() || undefined }).setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
    );

    await channel.send({ content: interaction.user + (pingStr ? " " + pingStr : ""), embeds: [welcome], components: [closeRow] }).catch(() => {});

    const logE = new EmbedBuilder().setTitle("Ticket Opened").setColor(WEBHOOK_COLOR)
        .addFields(
            { name: "Ticket #", value: String(ticketNumber), inline: true },
            { name: "Type", value: cfg.label, inline: true },
            { name: "User", value: interaction.user.tag, inline: true },
            { name: "Channel", value: channel.toString(), inline: false }
        ).setTimestamp();
    await broadcast(guild, logE, ["ticket", "webhook"]);
    return interaction.editReply({ embeds: [successEmbed("Ticket created: " + channel)] });
}

async function handleTicketClose(interaction) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    const ticket = gc.tickets[interaction.channel.id];
    if (!ticket) return interaction.reply({ embeds: [errorEmbed("Not a ticket.")], ephemeral: true });
    const isOwner = interaction.user.id === ticket.userId;
    const isStaffish = getMemberTiers(interaction.member).size > 0;
    if (!isOwner && !isStaffish) return interaction.reply({ embeds: [errorEmbed("Only owner or staff.")], ephemeral: true });
    await interaction.reply({ embeds: [infoEmbed("🔒 Closing and generating transcript...")] });

    (async () => {
        try {
            const messages = await interaction.channel.messages.fetch({ limit: 500 });
            const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
            let text = "=== Ticket #" + ticket.number + " Transcript ===\nType: " + ticket.type + "\nUser ID: " + ticket.userId + "\nClosed by: " + interaction.user.tag + " (" + interaction.user.id + ")\nClosed at: " + new Date().toISOString() + "\n======================================\n\n";
            for (const m of sorted) {
                text += "[" + new Date(m.createdTimestamp).toISOString() + "] " + m.author.tag + ": " + (m.content || "<no text>") + "\n";
                if (m.attachments.size) for (const a of m.attachments.values()) text += "   [attachment] " + a.url + "\n";
            }
            const attachment = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: "transcript-" + ticket.number + "-" + ticket.type + ".txt" });
            const tEmbed = new EmbedBuilder().setTitle("Ticket Transcript — #" + ticket.number).setColor(WEBHOOK_COLOR)
                .addFields(
                    { name: "Type", value: ticket.type, inline: true },
                    { name: "Owner", value: "<@" + ticket.userId + ">", inline: true },
                    { name: "Closed By", value: interaction.user.tag, inline: true }
                ).setTimestamp();
            await sendTranscript(guild, attachment, tEmbed);
        } catch (e) { console.error("transcript:", e); }
    })();

    ticket.open = false; ticket.closedAt = Date.now(); ticket.closedBy = interaction.user.id; saveConfig();
    const logE = new EmbedBuilder().setTitle("Ticket Closed").setColor(0xED4245)
        .addFields(
            { name: "Ticket #", value: String(ticket.number), inline: true },
            { name: "Type", value: ticket.type, inline: true },
            { name: "Closed By", value: interaction.user.tag, inline: true }
        ).setTimestamp();
    await broadcast(guild, logE, ["ticket", "webhook"]);
    setTimeout(async () => { try { await interaction.channel.delete("Ticket closed"); } catch {} }, 5000);
}

// ==========================================
// VOTES / EMBEDS
// ==========================================

async function handleVoteButton(interaction) {
    try {
        const parts = interaction.customId.split("_");
        if (parts.length < 4) return interaction.reply({ embeds: [errorEmbed("Invalid.")], ephemeral: true });
        const [, direction, type, messageId] = parts;
        const gc = getGuildConfig(interaction.guild.id);
        const store = type === "suggestion" ? gc.suggestions : gc.staffFeedback;
        if (!store[messageId]) return interaction.reply({ embeds: [errorEmbed("Invalid vote.")], ephemeral: true });
        const data = store[messageId];
        const userId = interaction.user.id;
        data.upvotes = data.upvotes.filter(id => id !== userId);
        data.downvotes = data.downvotes.filter(id => id !== userId);
        if (direction === "up") data.upvotes.push(userId); else data.downvotes.push(userId);
        saveConfig();

        let updatedEmbed;
        if (type === "suggestion") {
            const author = await client.users.fetch(data.authorId).catch(() => null) || { id: data.authorId };
            updatedEmbed = buildSuggestionEmbed(data.content, author, data.upvotes.length, data.downvotes.length);
        } else {
            const [staffMember, author] = await Promise.all([
                client.users.fetch(data.staffId).catch(() => null) || { id: data.staffId },
                client.users.fetch(data.authorId).catch(() => null) || { id: data.authorId }
            ]);
            updatedEmbed = buildStaffFeedbackEmbed(staffMember, data.content, author, data.upvotes.length, data.downvotes.length);
        }
        await interaction.message.edit({ embeds: [updatedEmbed], components: [buildVoteRow(messageId, type)] });
        return interaction.reply({ embeds: [successEmbed("Voted.")], ephemeral: true });
    } catch (e) { console.error(e); }
}

function buildSuggestionEmbed(suggestion, author, upvotes, downvotes) {
    return new EmbedBuilder().setTitle("New Suggestion").setDescription(suggestion).setColor(0x5865F2)
        .addFields(
            { name: "Author", value: String(author), inline: true },
            { name: "Status", value: "Pending Review", inline: true },
            { name: "Votes", value: "👍 " + upvotes + " | 👎 " + downvotes, inline: true }
        ).setFooter({ text: "User ID: " + author.id }).setTimestamp();
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

function buildVerifyEmbed(guild) {
    return new EmbedBuilder().setTitle("Verification Required")
        .setDescription(
            "**Welcome to " + guild.name + ".**\n\nPlease complete Roblox verification to unlock access to all channels.\n\n" +
            "**How to verify:**\n> 1. Click **Verify** below.\n> 2. Enter your Roblox username.\n> 3. Paste the code into your Roblox About section.\n> 4. Return and click **Check Verification**.\n\n" +
            "**Need help?**\n> Click **I Can't Verify** to open a support ticket."
        )
        .setColor(EMBED_ACCENT).setThumbnail(guild.iconURL({ size: 256 }))
        .setFooter({ text: guild.name + " • Verification System", iconURL: guild.iconURL() || undefined }).setTimestamp();
}
function buildVerifyRows() {
    return [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("verify_start").setLabel("Verify").setEmoji("✅").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("verify_check").setLabel("Check Verification").setEmoji("🔄").setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId("verify_help").setLabel("I Can't Verify").setEmoji("❓").setStyle(ButtonStyle.Secondary)
    )];
}
function buildTicketPanelEmbed(guild) {
    return new EmbedBuilder().setTitle("🎫 Need Assistance?")
        .setDescription("**" + guild.name + " | Support Assistant**\n\n⚙️ **Need Assistance?**\n> Click **Open a Ticket** below.\n\nℹ️ **Server Rules**\n> Please review the Ticket Rules before proceeding.")
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
// MESSAGE HANDLER (prefix + AFK tracking + AFK mention notify)
// ==========================================

client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const guild = message.guild;
    const gc = getGuildConfig(guild.id);

    // ----- 1) CLEAR AFK if the author was AFK -----
    if (gc.afk[message.author.id]) {
        clearAfkIfSet(guild, message.member, message.channel).catch(() => {});
    }

    // ----- 2) NOTIFY AFK MENTIONS -----
    notifyAfkMentions(message).catch(() => {});

    // ----- 3) PREFIX COMMANDS -----
    const prefix = getPrefix(guild.id);
    if (!message.content.startsWith(prefix)) return;
    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = (args.shift() || "").toLowerCase();
    if (!command) return;

    try {
        if (command === "help") {
            const embed = new EmbedBuilder().setTitle(guild.name + " — Prefix Commands").setColor(WEBHOOK_COLOR)
                .addFields({ name: "Prefix Commands", value: [
                    "`" + prefix + "help`",
                    "`" + prefix + "roles` — list all roles (staff)",
                    "`" + prefix + "serverinfo` — server info",
                    "`" + prefix + "afk [reason]` — set AFK",
                    "`" + prefix + "av [@user]` — avatar",
                    "`" + prefix + "loguser <username> <Warn|Kick|Ban> <reason>`"
                ].join("\n") });
            return message.reply({ embeds: [embed] });
        }

        if (command === "roles") {
            if (!canRunCommand(message.member, "roles")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] });
            return cmdRoles(message, false);
        }
        if (command === "serverinfo") {
            if (!canRunCommand(message.member, "serverinfo")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] });
            return cmdServerInfo(message, false);
        }
        if (command === "afk") {
            if (!canRunCommand(message.member, "afk")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] });
            const reason = args.join(" ").slice(0, 200) || "AFK";
            return cmdAfk(message, false, reason);
        }
        if (command === "av" || command === "avatar") {
            if (!canRunCommand(message.member, "av")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] });
            const target = message.mentions.users.first() || null;
            return cmdAv(message, false, target);
        }

        if (command === "loguser") {
            if (!canRunCommand(message.member, "loguser")) return message.reply({ embeds: [errorEmbed("You don't have permission.")] });
            const username = args[0], raw = (args[1] || "").toLowerCase(), reason = args.slice(2).join(" ");
            const valid = ["warn", "kick", "ban"];
            if (!username || !valid.includes(raw) || !reason) return message.reply({ embeds: [errorEmbed("Usage: `" + prefix + "loguser <username> <Warn|Kick|Ban> <reason>`")] });
            message.channel.sendTyping().catch(() => {});
            const robloxData = await lookupRobloxUser(username);
            const meta = { warn: { label: "Warn", emoji: "⚠️", color: 0xFEE75C }, kick: { label: "Kick", emoji: "👢", color: 0xE67E22 }, ban: { label: "Ban", emoji: "🔨", color: 0xED4245 } }[raw];
            const embed = new EmbedBuilder().setTitle(meta.emoji + " " + meta.label + " Logged").setColor(meta.color)
                .addFields(
                    { name: "Roblox Username", value: robloxData ? robloxData.username : username, inline: true },
                    { name: "Roblox ID", value: robloxData ? String(robloxData.id) : "Not found", inline: true },
                    { name: "Punishment", value: meta.label, inline: true },
                    { name: "Mod", value: message.author.tag, inline: true },
                    { name: "Reason", value: reason, inline: false }
                ).setTimestamp();
            if (robloxData?.avatarUrl) embed.setThumbnail(robloxData.avatarUrl);
            await broadcast(guild, embed, ["staff", "log", "webhook"]);
            return message.reply({ embeds: [successEmbed("Recorded.")] });
        }
    } catch (e) { console.error(e); try { await message.reply({ embeds: [errorEmbed("Error.")] }); } catch {} }
});

// ==========================================
// MEMBER JOIN / LEAVE
// ==========================================

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
        const embed = logEmbed("Member Joined",
            "**User:** " + member + " (" + member.user.tag + ")\n**ID:** " + member.id + "\n**Account Age:** " + accountAge + " days\n**Member Count:** " + guild.memberCount + (wasMuted ? "\n\n⚠️ **Auto-muted (24h rejoin watch)**" : ""),
            wasMuted ? 0xED4245 : 0x57F287);
        await broadcast(guild, embed, ["log", "webhook"]);
    } catch (e) { console.error(e); }
});

client.on("guildMemberRemove", async member => {
    try {
        // Clear AFK on leave
        const gc = getGuildConfig(member.guild.id);
        if (gc.afk[member.id]) { delete gc.afk[member.id]; saveConfig(); }

        const embed = logEmbed("Member Left", "**User:** " + member.user.tag + "\n**ID:** " + member.id, 0xED4245);
        broadcast(member.guild, embed, ["log", "webhook"]).catch(() => {});
        if (!member.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const executor = await fetchAuditExecutor(member.guild, 20, member.id);
        if (executor) await handleAntinukeEvent(member.guild, executor.id, "Kick");
    } catch (e) { console.error(e); }
});

// ==========================================
// ANTI-NUKE HOOKS
// ==========================================

client.on("channelDelete", async channel => {
    try {
        if (!channel.guild) return;
        broadcast(channel.guild, logEmbed("Channel Deleted", "**Name:** " + channel.name + "\n**ID:** " + channel.id, 0xED4245), ["log"]).catch(() => {});
        if (!channel.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const exec = await fetchAuditExecutor(channel.guild, 12, channel.id);
        if (exec) await handleAntinukeEvent(channel.guild, exec.id, "Channel Delete");
    } catch (e) { console.error(e); }
});

client.on("roleDelete", async role => {
    try {
        broadcast(role.guild, logEmbed("Role Deleted", "**Role:** " + role.name + "\n**ID:** " + role.id, 0xED4245), ["log"]).catch(() => {});
        if (!role.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const exec = await fetchAuditExecutor(role.guild, 32, role.id);
        if (exec) await handleAntinukeEvent(role.guild, exec.id, "Role Delete");
    } catch (e) { console.error(e); }
});

client.on("guildBanAdd", async ban => {
    try {
        const embed = logEmbed("Member Banned", "**User:** " + ban.user.tag + "\n**ID:** " + ban.user.id + "\n**Reason:** " + (ban.reason || "None"), 0xED4245);
        broadcast(ban.guild, embed, ["log", "webhook"]).catch(() => {});
        if (!ban.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const exec = await fetchAuditExecutor(ban.guild, 22, ban.user.id);
        if (exec) await handleAntinukeEvent(ban.guild, exec.id, "Ban");
    } catch (e) { console.error(e); }
});

// ==========================================
// OTHER LOGS
// ==========================================

client.on("messageDelete", async message => {
    try {
        if (!message.guild || message.author?.bot) return;
        broadcast(message.guild, logEmbed("Message Deleted",
            "**Author:** " + (message.author?.tag || "Unknown") + "\n**Channel:** " + message.channel + "\n**Content:** " + (message.content || "*None*").slice(0, 1500), 0xED4245), ["log"]).catch(() => {});
    } catch {}
});

client.on("messageUpdate", async (o, n) => {
    try {
        if (!o.guild || o.author?.bot || o.content === n.content) return;
        broadcast(o.guild, logEmbed("Message Edited",
            "**Author:** " + (o.author?.tag || "Unknown") + "\n**Channel:** " + o.channel + "\n**Before:** " + (o.content || "*None*").slice(0, 800) + "\n**After:** " + (n.content || "*None*").slice(0, 800), 0xFEE75C), ["log"]).catch(() => {});
    } catch {}
});

client.on("roleCreate",  async r => { try { broadcast(r.guild, logEmbed("Role Created", "**Role:** " + r + "\n**ID:** " + r.id, 0x57F287), ["log"]).catch(() => {}); } catch {} });
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