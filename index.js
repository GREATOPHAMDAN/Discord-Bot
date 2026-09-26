// ==========================================
// EAGLE COUNTY ROLEPLAY BOT - V.1.4.1
// ==========================================

const {
    Client,
    GatewayIntentBits,
    Partials,
    EmbedBuilder,
    SlashCommandBuilder,
    PermissionFlagsBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    ChannelType,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    ChannelSelectMenuBuilder,
    RoleSelectMenuBuilder,
    UserSelectMenuBuilder,
    WebhookClient,
    AttachmentBuilder
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");

dotenv.config();
const TOKEN = process.env.TOKEN;
if (!TOKEN) { console.error("ERROR: TOKEN is missing from .env"); process.exit(1); }

// ==========================================
// CONSTANTS
// ==========================================

const CONFIG_FILE = path.join(__dirname, "config.json");
const DEFAULT_PREFIX = "!";
const DAILY_LIMIT = 15;
const WEBHOOK_COLOR = 0x2563EB;
const EMBED_ACCENT = 0xFF8C00;

// Anti-nuke
const REJOIN_WATCH_MS = 24 * 60 * 60 * 1000;   // 24 hours
const REJOIN_MUTE_MS = 24 * 60 * 60 * 1000;    // 24 hour timeout

const DEFAULT_ANTINUKE = {
    enabled: true,
    threshold: 5,
    windowMs: 60000,
    whitelist: [],
    counters: {},
    watchlist: {} // userId -> expiry timestamp
};

// ==========================================
// CLIENT
// ==========================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.DirectMessages
    ],
    partials: [
        Partials.Message,
        Partials.Channel,
        Partials.GuildMember,
        Partials.User,
        Partials.Reaction
    ]
});

// ==========================================
// CONFIG
// ==========================================

function createDefaultGuildConfig() {
    return {
        prefix: DEFAULT_PREFIX,
        logChannelId: null,
        verificationLogChannelId: null,
        transcriptChannelId: null,
        welcomeChannelId: null,
        suggestionChannelId: null,
        staffFeedbackChannelId: null,
        staffLogChannelId: null,
        hrLogChannelId: null,
        verifyChannelId: null,
        ticketLogChannelId: null,

        ticketSupportCategoryId: null,
        ticketSupportPingRoleId: null,
        ticketHighRankCategoryId: null,
        ticketHighRankPingRoleId: null,

        webhookUrl: null,

        staffRoles: [],
        adminRoles: [],
        managementRoles: [],
        exemptRoles: [],
        verifyRoleId: null,
        acceptRoleIds: [],

        dmTemplates: {
            accept: "Congratulations! Your application for **{server}** has been accepted.\n\nPlease review the server for next steps.",
            promote: "You have been **promoted** in **{server}**!\n\n**New Rank:** {rank}",
            demote: "You have been **demoted** in **{server}**.\n\n**New Rank:** {rank}",
            infract: "You have received an infraction in **{server}**.\n\n**Type:** {type}\n**Reason:** {reason}"
        },

        antinuke: JSON.parse(JSON.stringify(DEFAULT_ANTINUKE)),

        verifySessions: {},
        verifiedUsers: {},
        tickets: {},
        ticketCounter: 0,
        suggestions: {},
        staffFeedback: {},
        limits: {}
    };
}

function loadConfig() {
    try {
        if (!fs.existsSync(CONFIG_FILE)) {
            const newConfig = { guilds: {} };
            fs.writeFileSync(CONFIG_FILE, JSON.stringify(newConfig, null, 4));
            return newConfig;
        }
        const data = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
        if (!data.guilds) data.guilds = {};
        return data;
    } catch (error) {
        console.error("Failed to load config:", error);
        return { guilds: {} };
    }
}

let config = loadConfig();

function saveConfig() {
    try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4)); }
    catch (error) { console.error("Failed to save config:", error); }
}

function getGuildConfig(guildId) {
    if (!config.guilds[guildId]) {
        config.guilds[guildId] = createDefaultGuildConfig();
        saveConfig();
    }
    const gc = config.guilds[guildId];
    const defaults = createDefaultGuildConfig();
    for (const key of Object.keys(defaults)) {
        if (gc[key] === undefined) gc[key] = defaults[key];
    }
    if (gc.acceptRoleId && (!gc.acceptRoleIds || gc.acceptRoleIds.length === 0)) gc.acceptRoleIds = [gc.acceptRoleId];
    if (gc.ticketCategoryId && !gc.ticketSupportCategoryId) gc.ticketSupportCategoryId = gc.ticketCategoryId;
    if (gc.ticketCategoryHighRankId && !gc.ticketHighRankCategoryId) gc.ticketHighRankCategoryId = gc.ticketCategoryHighRankId;
    if (!gc.antinuke) gc.antinuke = JSON.parse(JSON.stringify(DEFAULT_ANTINUKE));
    if (!gc.antinuke.counters) gc.antinuke.counters = {};
    if (!Array.isArray(gc.antinuke.whitelist)) gc.antinuke.whitelist = [];
    if (!gc.antinuke.watchlist) gc.antinuke.watchlist = {};
    return gc;
}

// ==========================================
// HELPERS
// ==========================================

function getToday() { return new Date().toISOString().split("T")[0]; }

function getLimitData(guildId, userId) {
    const gc = getGuildConfig(guildId);
    const today = getToday();
    if (!gc.limits[userId] || gc.limits[userId].date !== today) {
        gc.limits[userId] = { date: today, mutes: 0, kicks: 0 };
    }
    return gc.limits[userId];
}

function getPrefix(guildId) { return getGuildConfig(guildId).prefix || DEFAULT_PREFIX; }

function getOrdinalSuffix(n) {
    const s = ["th", "st", "nd", "rd"];
    const v = n % 100;
    return s[(v - 20) % 10] || s[v] || s[0];
}

function hasRole(member, roleIds) {
    if (!member?.roles || !Array.isArray(roleIds)) return false;
    return member.roles.cache.some(role => roleIds.includes(role.id));
}

function isStaff(member) {
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const gc = getGuildConfig(member.guild.id);
    return hasRole(member, gc.adminRoles) || hasRole(member, gc.staffRoles) || hasRole(member, gc.managementRoles);
}

function isAdmin(member) {
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const gc = getGuildConfig(member.guild.id);
    return hasRole(member, gc.adminRoles) || hasRole(member, gc.managementRoles);
}

function isExempt(member) {
    if (!member) return false;
    const gc = getGuildConfig(member.guild.id);
    return hasRole(member, gc.exemptRoles);
}

function canModerate(moderator, target) {
    if (!moderator || !target) return false;
    if (target.id === moderator.id) return false;
    if (target.id === moderator.guild.ownerId) return false;
    const modHighest = moderator.roles?.highest?.position ?? -1;
    const targetHighest = target.roles?.highest?.position ?? -1;
    return targetHighest < modHighest;
}

function parseDuration(input) {
    if (!input) return null;
    const match = input.match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return null;
    const amount = Number(match[1]);
    const unit = match[2].toLowerCase();
    const multipliers = { s: 1000, m: 60000, h: 3600000, d: 86400000 };
    const ms = amount * multipliers[unit];
    if (ms > 28 * 24 * 60 * 60 * 1000) return null;
    return ms;
}

function generateCode() {
    return "ECRP-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

function templateReplace(template, vars) {
    let out = template;
    for (const [k, v] of Object.entries(vars)) {
        out = out.replace(new RegExp("\\{" + k + "\\}", "g"), String(v));
    }
    return out;
}

// ==========================================
// EMBEDS
// ==========================================

function createLogEmbed(title, description, color = 0x808080) {
    return new EmbedBuilder().setTitle(title).setDescription(description).setColor(color).setTimestamp();
}
function createErrorEmbed(description) {
    return new EmbedBuilder().setTitle("Error").setDescription(description).setColor(0xED4245).setTimestamp();
}
function createSuccessEmbed(description) {
    return new EmbedBuilder().setTitle("Success").setDescription(description).setColor(0x57F287).setTimestamp();
}
function createInfoEmbed(description) {
    return new EmbedBuilder().setDescription(description).setColor(WEBHOOK_COLOR).setTimestamp();
}

// ==========================================
// LOGGING
// ==========================================

async function sendToChannel(guild, channelId, embed) {
    if (!channelId) return;
    try {
        const ch = guild.channels.cache.get(channelId);
        if (!ch) return;
        await ch.send({ embeds: [embed] });
    } catch (e) { console.error("sendToChannel:", e); }
}
async function sendLog(guild, embed) { await sendToChannel(guild, getGuildConfig(guild.id).logChannelId, embed); }
async function sendVerificationLog(guild, embed) {
    const gc = getGuildConfig(guild.id);
    await sendToChannel(guild, gc.verificationLogChannelId || gc.logChannelId, embed);
}
async function sendStaffLog(guild, embed) { await sendToChannel(guild, getGuildConfig(guild.id).staffLogChannelId, embed); }
async function sendHRLog(guild, embed) { await sendToChannel(guild, getGuildConfig(guild.id).hrLogChannelId, embed); }
async function sendTicketLog(guild, embed) { await sendToChannel(guild, getGuildConfig(guild.id).ticketLogChannelId, embed); }
async function sendTranscript(guild, attachment, embed) {
    const gc = getGuildConfig(guild.id);
    if (!gc.transcriptChannelId) return;
    try {
        const ch = guild.channels.cache.get(gc.transcriptChannelId);
        if (!ch) return;
        await ch.send({ embeds: [embed], files: [attachment] });
    } catch (e) { console.error("sendTranscript:", e); }
}
async function sendWebhook(guild, embed) {
    try {
        const gc = getGuildConfig(guild.id);
        if (!gc.webhookUrl) return;
        const finalEmbed = EmbedBuilder.from(embed).setColor(WEBHOOK_COLOR);
        if (guild.iconURL()) finalEmbed.setThumbnail(guild.iconURL({ dynamic: true, size: 256 }));
        finalEmbed.setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined });
        const wh = new WebhookClient({ url: gc.webhookUrl });
        await wh.send({
            username: guild.name,
            avatarURL: guild.iconURL({ dynamic: true }) || undefined,
            embeds: [finalEmbed]
        });
    } catch (e) { console.error("sendWebhook:", e); }
}

// ==========================================
// ROBLOX LOOKUP
// ==========================================

async function lookupRobloxUser(username) {
    try {
        const r = await fetch("https://users.roblox.com/v1/usernames/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        if (!r.ok) return null;
        const d = await r.json();
        if (!d.data?.length) return null;
        const userId = d.data[0].id;
        const dr = await fetch("https://users.roblox.com/v1/users/" + userId);
        if (!dr.ok) return null;
        const details = await dr.json();
        let avatarUrl = null;
        try {
            const ar = await fetch("https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + userId + "&size=420x420&format=Png&isCircular=false");
            if (ar.ok) { const ad = await ar.json(); if (ad.data?.length) avatarUrl = ad.data[0].imageUrl; }
        } catch (e) {}
        return {
            id: userId, username: details.name, displayName: details.displayName,
            description: details.description || "", created: details.created,
            avatarUrl, profileUrl: "https://www.roblox.com/users/" + userId + "/profile"
        };
    } catch (e) { console.error("Roblox:", e); return null; }
}

// ==========================================
// ANTI-NUKE CORE
// ==========================================

async function fetchAuditExecutor(guild, eventType, targetId, withinMs = 15000) {
    try {
        const logs = await guild.fetchAuditLogs({ type: eventType, limit: 5 });
        const now = Date.now();
        const entry = logs.entries.find(e =>
            now - e.createdTimestamp < withinMs &&
            (!targetId || (e.target && e.target.id === targetId))
        );
        return entry?.executor || null;
    } catch (e) { return null; }
}

function recordAntinukeEvent(guildId, userId) {
    const gc = getGuildConfig(guildId);
    const now = Date.now();
    const windowMs = gc.antinuke.windowMs || 60000;
    if (!gc.antinuke.counters[userId]) gc.antinuke.counters[userId] = [];
    gc.antinuke.counters[userId] = gc.antinuke.counters[userId].filter(t => now - t < windowMs);
    gc.antinuke.counters[userId].push(now);
    saveConfig();
    return gc.antinuke.counters[userId].length;
}

/**
 * Removes every role from a member (except @everyone).
 * Also handles hierarchy: if a role is not manageable by the bot,
 * it skips only THAT role but continues with the rest.
 */
async function stripAllRoles(member, reason) {
    if (!member) return { removed: 0, failed: 0 };
    const me = member.guild.members.me;

    // Every role except @everyone
    const allRoles = member.roles.cache.filter(r => r.id !== member.guild.id);

    let removed = 0;
    let failed = 0;

    for (const role of allRoles.values()) {
        const manageable = role.position < me.roles.highest.position && !role.managed;
        if (!manageable) { failed++; continue; }
        try {
            await member.roles.remove(role, reason);
            removed++;
        } catch (e) {
            failed++;
            console.error("stripAllRoles remove fail:", role.name, e.message);
        }
    }

    // Small delay to let Discord process
    await new Promise(r => setTimeout(r, 500));

    // Re-fetch to verify
    try {
        const fresh = await member.guild.members.fetch({ user: member.id, force: true });
        const stillHas = fresh.roles.cache.filter(r => r.id !== member.guild.id);
        if (stillHas.size > 0) {
            console.warn("stripAllRoles: still has " + stillHas.size + " roles after strip:", stillHas.map(r => r.name).join(", "));
        }
    } catch (e) { /* ignore */ }

    return { removed, failed };
}

async function triggerAntinuke(guild, member, trigger, count) {
    const gc = getGuildConfig(guild.id);

    // 1) STRIP ALL ROLES
    const { removed, failed } = await stripAllRoles(member, "Anti-Nuke: " + trigger);

    // 2) KICK THE USER
    let kicked = false;
    try {
        await member.kick("Anti-Nuke triggered: " + trigger);
        kicked = true;
    } catch (e) {
        console.error("anti-nuke kick failed:", e.message);
    }

    // 3) ADD TO 24h REJOIN WATCHLIST
    const expiry = Date.now() + REJOIN_WATCH_MS;
    gc.antinuke.watchlist[member.id] = expiry;
    // Reset counter
    gc.antinuke.counters[member.id] = [];
    saveConfig();

    // 4) LOG
    const logEmbed = new EmbedBuilder()
        .setTitle("🚨 ANTI-NUKE TRIGGERED")
        .setDescription(
            "**User:** " + member.user.tag + " (" + member.id + ")\n" +
            "**Trigger:** " + trigger + "\n" +
            "**Count in window:** " + count + "\n" +
            "**Roles Removed:** " + removed + (failed ? " (failed: " + failed + " — above my role)" : "") + "\n" +
            "**Kicked:** " + (kicked ? "Yes" : "No (missing Kick Members?)") + "\n" +
            "**Watchlist Expires:** <t:" + Math.floor(expiry / 1000) + ":R>"
        )
        .setColor(0xED4245)
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setTimestamp();

    await sendLog(guild, logEmbed);
    await sendWebhook(guild, logEmbed);

    // 5) DM the offender
    try {
        await member.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("⚠️ Anti-Nuke Triggered")
                    .setDescription(
                        "You triggered the anti-nuke protection in **" + guild.name + "**.\n\n" +
                        "**Trigger:** " + trigger + "\n" +
                        "**Count:** " + count + "\n\n" +
                        "All of your roles were removed and you were kicked.\n" +
                        "**If you rejoin within 24 hours, you will be instantly muted for 24 hours.**"
                    )
                    .setColor(0xED4245)
                    .setTimestamp()
            ]
        }).catch(() => {});
    } catch (e) { /* DMs closed */ }

    // 6) DM the owner
    try {
        const owner = await guild.fetchOwner();
        await owner.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle("🚨 Anti-Nuke Triggered in " + guild.name)
                    .setDescription(
                        "**User:** " + member.user.tag + " (" + member.id + ")\n" +
                        "**Trigger:** " + trigger + "\n" +
                        "**Count in window:** " + count + "\n" +
                        "**Roles Removed:** " + removed + "\n" +
                        "**Kicked:** " + (kicked ? "Yes" : "No") + "\n\n" +
                        "The user is now on a **24-hour rejoin watch**. If they rejoin, they will be auto-muted for 24h."
                    )
                    .setColor(0xED4245)
                    .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                    .setTimestamp()
            ]
        }).catch(() => {});
    } catch (e) { /* owner DMs closed */ }
}

async function handleAntinukeEvent(guild, userId, trigger) {
    try {
        const gc = getGuildConfig(guild.id);
        if (!gc.antinuke.enabled) return;
        if (gc.antinuke.whitelist.includes(userId)) return;
        if (userId === guild.ownerId) return;
        if (userId === client.user.id) return;

        const count = recordAntinukeEvent(guild.id, userId);
        if (count >= gc.antinuke.threshold) {
            const member = await guild.members.fetch(userId).catch(() => null);
            if (!member) return;
            await triggerAntinuke(guild, member, trigger, count);
        }
    } catch (e) { console.error("handleAntinukeEvent:", e); }
}

// ==========================================
// REJOIN WATCH CHECK
// ==========================================

async function checkRejoinWatch(member) {
    try {
        const gc = getGuildConfig(member.guild.id);
        const expiry = gc.antinuke.watchlist[member.id];
        if (!expiry) return false;

        // Expired?
        if (Date.now() > expiry) {
            delete gc.antinuke.watchlist[member.id];
            saveConfig();
            return false;
        }

        // 1) Strip all roles again
        const { removed } = await stripAllRoles(member, "Anti-Nuke rejoin watch");

        // 2) Apply 24h timeout
        let muted = false;
        try {
            await member.timeout(REJOIN_MUTE_MS, "Anti-Nuke: rejoined within 24h watch window");
            muted = true;
        } catch (e) {
            console.error("rejoin mute failed:", e.message);
        }

        // 3) Log
        const logEmbed = new EmbedBuilder()
            .setTitle("🚨 Anti-Nuke Rejoin — Auto-Muted")
            .setDescription(
                "**User:** " + member.user.tag + " (" + member.id + ")\n" +
                "**Action:** Roles stripped + 24h timeout applied\n" +
                "**Roles Removed:** " + removed + "\n" +
                "**Muted:** " + (muted ? "Yes" : "No (missing Moderate Members permission?)") + "\n" +
                "**Watch Expires:** <t:" + Math.floor(expiry / 1000) + ":R>"
            )
            .setColor(0xED4245)
            .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
            .setTimestamp();

        await sendLog(member.guild, logEmbed);
        await sendWebhook(member.guild, logEmbed);

        // 4) DM the offender
        try {
            await member.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("🔇 Auto-Muted (Anti-Nuke)")
                        .setDescription(
                            "You rejoined **" + member.guild.name + "** while on anti-nuke watch.\n\n" +
                            "You have been **muted for 24 hours** and all roles have been removed.\n" +
                            "Contact the server owner if you believe this is a mistake."
                        )
                        .setColor(0xED4245)
                        .setTimestamp()
                ]
            }).catch(() => {});
        } catch (e) { /* ignore */ }

        // 5) DM owner
        try {
            const owner = await member.guild.fetchOwner();
            await owner.send({
                embeds: [
                    new EmbedBuilder()
                        .setTitle("⚠️ Anti-Nuke Watch Triggered")
                        .setDescription(
                            "**" + member.user.tag + "** rejoined within the 24h anti-nuke watch window.\n\n" +
                            "**Action taken:**\n" +
                            "• Roles stripped (" + removed + " removed)\n" +
                            "• 24-hour timeout applied\n" +
                            "• Watch still active until <t:" + Math.floor(expiry / 1000) + ":R>"
                        )
                        .setColor(0xED4245)
                        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
                        .setTimestamp()
                ]
            }).catch(() => {});
        } catch (e) { /* ignore */ }

        return true;
    } catch (e) {
        console.error("checkRejoinWatch:", e);
        return false;
    }
}

// ==========================================
// SLASH COMMANDS
// ==========================================

function getSlashCommands() {
    const commands = [
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

        new SlashCommandBuilder().setName("accept").setDescription("Accept a user's application (DMs them)")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Notes").setRequired(false)),
        new SlashCommandBuilder().setName("promote").setDescription("Promote a user (DMs them)")
            .addUserOption(o => o.setName("user").setDescription("User").setRequired(true))
            .addStringOption(o => o.setName("rank").setDescription("New rank").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Notes").setRequired(false)),
        new SlashCommandBuilder().setName("demote").setDescription("Demote a user (DMs them)")
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
        new SlashCommandBuilder().setName("kick").setDescription("Kick a member")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("ban").setDescription("Ban a member")
            .addUserOption(o => o.setName("user").setDescription("Member").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),
        new SlashCommandBuilder().setName("unban").setDescription("Unban a user")
            .addStringOption(o => o.setName("userid").setDescription("Discord User ID").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(false)),

        new SlashCommandBuilder().setName("loguser").setDescription("Log a punishment with Roblox lookup")
            .addStringOption(o => o.setName("username").setDescription("Roblox username").setRequired(true))
            .addStringOption(o => o.setName("punishment").setDescription("Punishment type").setRequired(true))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true)),

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
    return commands.map(c => c.toJSON());
}

async function registerCommands(guild) {
    try {
        await guild.commands.set(getSlashCommands());
        console.log("Slash commands registered in " + guild.name);
    } catch (error) {
        console.error("Failed to register commands in " + guild.name + ":", error);
    }
}

// ==========================================
// READY
// ==========================================

client.once("ready", async () => {
    console.log("--------------------------------");
    console.log("Logged in as " + client.user.tag);
    console.log("Servers: " + client.guilds.cache.size);
    console.log("--------------------------------");
    for (const guild of client.guilds.cache.values()) {
        getGuildConfig(guild.id);
        await registerCommands(guild);
    }
    client.user.setActivity("Eagle County Roleplay | V.1.4.1");

    // Cleanup expired watchlist entries
    for (const guild of client.guilds.cache.values()) {
        const gc = getGuildConfig(guild.id);
        const now = Date.now();
        let changed = false;
        for (const [uid, expiry] of Object.entries(gc.antinuke.watchlist)) {
            if (now > expiry) { delete gc.antinuke.watchlist[uid]; changed = true; }
        }
        if (changed) saveConfig();
    }
});

client.on("guildCreate", async guild => {
    getGuildConfig(guild.id);
    await registerCommands(guild);
    console.log("Joined server: " + guild.name);
});

// ==========================================
// DM TEMPLATES
// ==========================================

function buildTemplateDM(guild, templateKey, vars) {
    const gc = getGuildConfig(guild.id);
    const raw = gc.dmTemplates[templateKey] || "You have received a notification from **{server}**.";
    const text = templateReplace(raw, { server: guild.name, ...vars });
    return new EmbedBuilder()
        .setTitle(
            templateKey === "accept" ? "Application Accepted" :
            templateKey === "promote" ? "You Have Been Promoted" :
            templateKey === "demote" ? "You Have Been Demoted" :
            "Infraction Notice"
        )
        .setDescription(text)
        .setColor(templateKey === "demote" || templateKey === "infract" ? 0xED4245 : 0x57F287)
        .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

async function tryDM(user, embed) {
    try { await user.send({ embeds: [embed] }); return true; }
    catch (e) { return false; }
}

// ==========================================
// SETUP MENU
// ==========================================

function fmtCh(gc, key) { const id = gc[key]; return id ? "<#" + id + ">" : "❌ Not set"; }
function fmtRole(gc, key) { const id = gc[key]; return id ? "<@&" + id + ">" : "❌ Not set"; }
function fmtRoleList(arr) { return (!arr || !arr.length) ? "❌ None" : arr.map(id => "<@&" + id + ">").join(", "); }

function buildSetupEmbed(guild) {
    const gc = getGuildConfig(guild.id);
    const an = gc.antinuke;
    const watchCount = Object.keys(an.watchlist).filter(uid => an.watchlist[uid] > Date.now()).length;
    return new EmbedBuilder()
        .setTitle("⚙️ " + guild.name + " — Setup Menu (V.1.4.1)")
        .setDescription("Use the buttons below to configure the bot.")
        .setColor(WEBHOOK_COLOR)
        .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: "Prefix", value: "`" + gc.prefix + "`", inline: true },
            { name: "Webhook", value: gc.webhookUrl ? "✅" : "❌", inline: true },
            { name: "Anti-Nuke", value: an.enabled ? "✅ Enabled" : "❌ Disabled", inline: true },
            {
                name: "📁 Channels",
                value: [
                    "**Main Log:** " + fmtCh(gc, "logChannelId"),
                    "**Verification Log:** " + fmtCh(gc, "verificationLogChannelId"),
                    "**Transcripts:** " + fmtCh(gc, "transcriptChannelId"),
                    "**Welcome:** " + fmtCh(gc, "welcomeChannelId"),
                    "**Suggestions:** " + fmtCh(gc, "suggestionChannelId"),
                    "**Staff Feedback:** " + fmtCh(gc, "staffFeedbackChannelId"),
                    "**Staff Log:** " + fmtCh(gc, "staffLogChannelId"),
                    "**HR Log:** " + fmtCh(gc, "hrLogChannelId"),
                    "**Verify Panel Ch:** " + fmtCh(gc, "verifyChannelId"),
                    "**Ticket Log:** " + fmtCh(gc, "ticketLogChannelId")
                ].join("\n"),
                inline: false
            },
            {
                name: "🎭 Role Tiers",
                value: [
                    "**Staff:** " + fmtRoleList(gc.staffRoles),
                    "**Admin:** " + fmtRoleList(gc.adminRoles),
                    "**Management:** " + fmtRoleList(gc.managementRoles),
                    "**Exempt:** " + fmtRoleList(gc.exemptRoles),
                    "**Verify Role:** " + fmtRole(gc, "verifyRoleId"),
                    "**Accept Roles:** " + fmtRoleList(gc.acceptRoleIds)
                ].join("\n"),
                inline: false
            },
            {
                name: "🎫 Tickets",
                value: [
                    "**Support Category:** " + (gc.ticketSupportCategoryId ? "<#" + gc.ticketSupportCategoryId + ">" : "❌"),
                    "**Support Ping:** " + fmtRole(gc, "ticketSupportPingRoleId"),
                    "**High Rank Category:** " + (gc.ticketHighRankCategoryId ? "<#" + gc.ticketHighRankCategoryId + ">" : "❌"),
                    "**High Rank Ping:** " + fmtRole(gc, "ticketHighRankPingRoleId")
                ].join("\n"),
                inline: false
            },
            {
                name: "🛡️ Anti-Nuke",
                value: [
                    "**Enabled:** " + (an.enabled ? "Yes" : "No"),
                    "**Threshold:** " + an.threshold + " events / " + Math.floor(an.windowMs / 1000) + "s",
                    "**Whitelisted:** " + an.whitelist.length,
                    "**On 24h Rejoin Watch:** " + watchCount
                ].join("\n"),
                inline: false
            }
        )
        .setFooter({ text: "V.1.4.1 • " + guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

function buildSetupRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_channels").setLabel("Channels").setEmoji("📁").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_roles").setLabel("Role Tiers").setEmoji("🎭").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_tickets").setLabel("Tickets").setEmoji("🎫").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_dm_templates").setLabel("DM Templates").setEmoji("✉️").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
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
            new ButtonBuilder().setCustomId("setup_ch_verifylog").setLabel("Verification Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_transcript").setLabel("Transcript Channel").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_welcome").setLabel("Welcome").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_suggestions").setLabel("Suggestions").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ch_stafffb").setLabel("Staff Feedback").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_stafflog").setLabel("Staff Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_hrlog").setLabel("HR Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_verifypanel").setLabel("Verify Panel Ch").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_ticketlog").setLabel("Ticket Log").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back to Menu").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildRolesMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_role_staff").setLabel("Staff Roles").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_admin").setLabel("Admin Roles").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_management").setLabel("Management Roles").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_role_exempt").setLabel("Exempt Roles").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_role_verify").setLabel("Verify Role").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_accept").setLabel("Accept Roles").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_clear_staff").setLabel("Clear Staff").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_clear_admin").setLabel("Clear Admin").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_clear_management").setLabel("Clear Mgmt").setStyle(ButtonStyle.Danger)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_clear_exempt").setLabel("Clear Exempt").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_clear_accept").setLabel("Clear Accept").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back to Menu").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildTicketsMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ticket_support_cat").setLabel("Set Support Category").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ticket_support_ping").setLabel("Set Support Ping Role").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ticket_high_cat").setLabel("Set High Rank Category").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ticket_high_ping").setLabel("Set High Rank Ping Role").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ticket_ping_management").setLabel("Auto-Ping Management").setEmoji("🛠️").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back to Menu").setEmoji("◀️").setStyle(ButtonStyle.Danger)
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
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back to Menu").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildAntinukeMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_an_toggle").setLabel("Toggle On/Off").setEmoji("🔁").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_an_threshold").setLabel("Set Threshold").setEmoji("🔢").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_an_whitelist").setLabel("Whitelist User").setEmoji("✅").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_an_unwhitelist").setLabel("Unwhitelist User").setEmoji("❌").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_an_list").setLabel("Show Whitelist").setEmoji("📋").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_an_watchlist").setLabel("Show Watchlist").setEmoji("👁️").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_an_reset").setLabel("Reset Counters").setEmoji("♻️").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back to Menu").setEmoji("◀️").setStyle(ButtonStyle.Danger)
        )
    ];
}

// ==========================================
// SETUP NAVIGATION
// ==========================================

async function updateSetupMessage(interaction, view) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    let embed, rows;

    if (view === "main") { embed = buildSetupEmbed(guild); rows = buildSetupRows(); }
    else if (view === "channels") {
        embed = new EmbedBuilder().setTitle("📁 Channel Configuration")
            .setDescription("**Main Log** — all events\n**Verification Log** — verifications\n**Transcript Channel** — ticket transcripts\n**Welcome** — welcome messages\n**Suggestions** — /suggest\n**Staff Feedback** — /staff-feedback\n**Staff Log** — punishments\n**HR Log** — accept/promote/demote/infract\n**Verify Panel Ch** — verify panel\n**Ticket Log** — ticket events")
            .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL({ dynamic: true })).setTimestamp();
        rows = buildChannelsMenuRows();
    } else if (view === "roles") {
        embed = new EmbedBuilder().setTitle("🎭 Role Tiers")
            .setDescription("**Staff** — basic staff\n**Admin** — full admin\n**Management** ⭐ — highest tier, pinged on High Rank tickets\n**Exempt** — cannot be moderated\n**Verify Role** — auto-given on verify\n**Accept Roles** — given on accept")
            .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL({ dynamic: true })).setTimestamp();
        rows = buildRolesMenuRows();
    } else if (view === "tickets") {
        embed = new EmbedBuilder().setTitle("🎫 Ticket Configuration")
            .setDescription("**Support:** Support Category + Support Ping Role\n**High Rank:** High Rank Category + High Rank Ping Role (Management always pinged)")
            .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL({ dynamic: true })).setTimestamp();
        rows = buildTicketsMenuRows();
    } else if (view === "templates") {
        embed = new EmbedBuilder().setTitle("✉️ DM Templates")
            .setDescription("**Variables:** `{server}` `{rank}` `{type}` `{reason}` `{notes}`\n\n**Accept:**\n" + gc.dmTemplates.accept + "\n\n**Promote:**\n" + gc.dmTemplates.promote + "\n\n**Demote:**\n" + gc.dmTemplates.demote + "\n\n**Infract:**\n" + gc.dmTemplates.infract)
            .setColor(WEBHOOK_COLOR).setTimestamp();
        rows = buildTemplatesMenuRows();
    } else if (view === "antinuke") {
        const an = gc.antinuke;
        embed = new EmbedBuilder().setTitle("🛡️ Anti-Nuke Settings")
            .setDescription(
                "**What it does:**\n" +
                "If a user deletes more than **" + an.threshold + "** channels/roles, kicks, or bans **" + an.threshold + "** members within **" + Math.floor(an.windowMs / 1000) + "s**, the bot:\n" +
                "> 1. Removes **every role** from the user (except @everyone)\n" +
                "> 2. **Kicks** the user\n" +
                "> 3. **24-hour rejoin watch** — if they rejoin, roles stripped + **24h mute**\n" +
                "> 4. DMs the offender + server owner\n" +
                "> 5. Logs to main log + webhook\n\n" +
                "**Current:**\n" +
                "• Enabled: " + (an.enabled ? "✅" : "❌") + "\n" +
                "• Threshold: **" + an.threshold + "**\n" +
                "• Window: **" + Math.floor(an.windowMs / 1000) + "s**\n" +
                "• Whitelisted: **" + an.whitelist.length + "**"
            )
            .setColor(0xED4245).setThumbnail(guild.iconURL({ dynamic: true })).setTimestamp();
        rows = buildAntinukeMenuRows();
    }
    await interaction.update({ embeds: [embed], components: rows });
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

        if (command === "setup") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            return interaction.reply({ embeds: [buildSetupEmbed(guild)], components: buildSetupRows(), ephemeral: true });
        }
        if (command === "setprefix") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const prefix = interaction.options.getString("prefix");
            if (/\s/.test(prefix)) return interaction.reply({ embeds: [createErrorEmbed("No spaces.")], ephemeral: true });
            gc.prefix = prefix; saveConfig();
            return interaction.reply({ embeds: [createSuccessEmbed("Prefix set to `" + prefix + "`.")] });
        }
        if (command === "setupverify") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            gc.verifyChannelId = interaction.channel.id; saveConfig();
            await interaction.channel.send({ embeds: [buildVerifyEmbed(guild)], components: buildVerifyRows() });
            return interaction.reply({ embeds: [createSuccessEmbed("Verification panel posted.")], ephemeral: true });
        }
        if (command === "setuptickets") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            await interaction.channel.send({ embeds: [buildTicketPanelEmbed(guild)], components: buildTicketPanelRows() });
            return interaction.reply({ embeds: [createSuccessEmbed("Ticket panel posted.")], ephemeral: true });
        }
        if (command === "set-webhook") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const url = interaction.options.getString("url");
            if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(url)) return interaction.reply({ embeds: [createErrorEmbed("Invalid URL.")], ephemeral: true });
            gc.webhookUrl = url; saveConfig();
            return interaction.reply({ embeds: [createSuccessEmbed("Webhook set.")], ephemeral: true });
        }
        if (command === "remove-webhook") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            gc.webhookUrl = null; saveConfig();
            return interaction.reply({ embeds: [createSuccessEmbed("Removed.")], ephemeral: true });
        }
        if (command === "acceptsetup") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const sub = interaction.options.getSubcommand();
            if (sub === "add") { const role = interaction.options.getRole("role"); if (!gc.acceptRoleIds.includes(role.id)) gc.acceptRoleIds.push(role.id); saveConfig(); return interaction.reply({ embeds: [createSuccessEmbed(role + " added.")] }); }
            if (sub === "remove") { const role = interaction.options.getRole("role"); gc.acceptRoleIds = gc.acceptRoleIds.filter(id => id !== role.id); saveConfig(); return interaction.reply({ embeds: [createSuccessEmbed("Removed.")] }); }
            if (sub === "list") return interaction.reply({ embeds: [createInfoEmbed("**Accept Roles:** " + fmtRoleList(gc.acceptRoleIds))], ephemeral: true });
            if (sub === "clear") { gc.acceptRoleIds = []; saveConfig(); return interaction.reply({ embeds: [createSuccessEmbed("Cleared.")] }); }
        }

        // ---------- /antinuke ----------
        if (command === "antinuke") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const sub = interaction.options.getSubcommand();
            const an = gc.antinuke;

            if (sub === "status") {
                const watchCount = Object.keys(an.watchlist).filter(uid => an.watchlist[uid] > Date.now()).length;
                const embed = new EmbedBuilder().setTitle("🛡️ Anti-Nuke Status").setColor(WEBHOOK_COLOR)
                    .addFields(
                        { name: "Enabled", value: an.enabled ? "✅" : "❌", inline: true },
                        { name: "Threshold", value: String(an.threshold), inline: true },
                        { name: "Window", value: Math.floor(an.windowMs / 1000) + "s", inline: true },
                        { name: "Whitelist", value: an.whitelist.length ? an.whitelist.map(id => "<@" + id + ">").join(", ") : "None", inline: false },
                        { name: "24h Rejoin Watch", value: String(watchCount) + " user(s)", inline: true }
                    );
                return interaction.reply({ embeds: [embed], ephemeral: true });
            }
            if (sub === "enable") { an.enabled = true; saveConfig(); return interaction.reply({ embeds: [createSuccessEmbed("Anti-Nuke enabled.")] }); }
            if (sub === "disable") { an.enabled = false; saveConfig(); return interaction.reply({ embeds: [createSuccessEmbed("Anti-Nuke disabled.")] }); }
            if (sub === "threshold") { const count = interaction.options.getInteger("count"); an.threshold = count; saveConfig(); return interaction.reply({ embeds: [createSuccessEmbed("Threshold set to **" + count + "**.")] }); }
            if (sub === "whitelist-add") { const user = interaction.options.getUser("user"); if (!an.whitelist.includes(user.id)) an.whitelist.push(user.id); saveConfig(); return interaction.reply({ embeds: [createSuccessEmbed(user.tag + " whitelisted.")] }); }
            if (sub === "whitelist-remove") { const user = interaction.options.getUser("user"); an.whitelist = an.whitelist.filter(id => id !== user.id); saveConfig(); return interaction.reply({ embeds: [createSuccessEmbed("Removed.")] }); }
            if (sub === "whitelist-list") { const list = an.whitelist.length ? an.whitelist.map(id => "<@" + id + ">").join(", ") : "None"; return interaction.reply({ embeds: [createInfoEmbed("**Whitelisted:** " + list)], ephemeral: true }); }
            if (sub === "watchlist") {
                const now = Date.now();
                const entries = Object.entries(an.watchlist).filter(([, e]) => e > now);
                if (!entries.length) return interaction.reply({ embeds: [createInfoEmbed("No users on 24h rejoin watch.")], ephemeral: true });
                const lines = entries.map(([uid, e]) => "• <@" + uid + "> — expires <t:" + Math.floor(e / 1000) + ":R>");
                return interaction.reply({ embeds: [createInfoEmbed("**On Rejoin Watch:**\n" + lines.join("\n"))], ephemeral: true });
            }
            if (sub === "unwatch") { const user = interaction.options.getUser("user"); delete an.watchlist[user.id]; saveConfig(); return interaction.reply({ embeds: [createSuccessEmbed(user.tag + " removed from watch.")] }); }
            if (sub === "reset") { an.counters = {}; saveConfig(); return interaction.reply({ embeds: [createSuccessEmbed("Counters reset.")] }); }
        }

        // ---------- HR ----------
        if (command === "accept") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const notes = interaction.options.getString("notes") || null;
            await interaction.deferReply();
            let roleGiven = 0;
            if (gc.acceptRoleIds.length) {
                const member = await guild.members.fetch(targetUser.id).catch(() => null);
                if (member) for (const rid of gc.acceptRoleIds) { try { await member.roles.add(rid, "Accepted"); roleGiven++; } catch (e) {} }
            }
            const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "accept", { notes: notes || "" }));
            const logEmbed = new EmbedBuilder().setTitle("Application Accepted").setColor(0x57F287)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "By", value: interaction.user.tag, inline: true },
                    { name: "Roles", value: String(roleGiven), inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No", inline: true }
                ).setTimestamp();
            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024) });
            await sendHRLog(guild, logEmbed); await sendLog(guild, logEmbed); await sendWebhook(guild, logEmbed);
            return interaction.editReply({ embeds: [createSuccessEmbed(targetUser.tag + " accepted.")] });
        }
        if (command === "promote") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const rank = interaction.options.getString("rank");
            const notes = interaction.options.getString("notes") || null;
            await interaction.deferReply();
            const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "promote", { rank, notes: notes || "" }));
            const logEmbed = new EmbedBuilder().setTitle("Promotion").setColor(0x57F287)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "New Rank", value: rank, inline: true },
                    { name: "By", value: interaction.user.tag, inline: true },
                    { name: "DM", value: dmSent ? "Yes" : "No", inline: true }
                ).setTimestamp();
            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024) });
            await sendHRLog(guild, logEmbed); await sendLog(guild, logEmbed); await sendWebhook(guild, logEmbed);
            return interaction.editReply({ embeds: [createSuccessEmbed(targetUser.tag + " promoted to **" + rank + "**.")] });
        }
        if (command === "demote") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const rank = interaction.options.getString("rank");
            const notes = interaction.options.getString("notes") || null;
            await interaction.deferReply();
            const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "demote", { rank, notes: notes || "" }));
            const logEmbed = new EmbedBuilder().setTitle("Demotion").setColor(0xED4245)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "New Rank", value: rank, inline: true },
                    { name: "By", value: interaction.user.tag, inline: true },
                    { name: "DM", value: dmSent ? "Yes" : "No", inline: true }
                ).setTimestamp();
            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024) });
            await sendHRLog(guild, logEmbed); await sendLog(guild, logEmbed); await sendWebhook(guild, logEmbed);
            return interaction.editReply({ embeds: [createSuccessEmbed(targetUser.tag + " demoted.")] });
        }
        if (command === "infract") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const type = interaction.options.getString("type");
            const reason = interaction.options.getString("reason");
            const notes = interaction.options.getString("notes") || null;
            await interaction.deferReply();
            const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "infract", { type, reason, notes: notes || "" }));
            const colors = { warn: 0xFEE75C, strike: 0xED4245, demotion: 0xED4245, suspension: 0x992D22 };
            const logEmbed = new EmbedBuilder().setTitle("Infraction").setColor(colors[type] || 0xED4245)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "Type", value: type, inline: true },
                    { name: "By", value: interaction.user.tag, inline: true },
                    { name: "DM", value: dmSent ? "Yes" : "No", inline: true },
                    { name: "Reason", value: reason, inline: false }
                ).setTimestamp();
            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024) });
            await sendHRLog(guild, logEmbed); await sendLog(guild, logEmbed); await sendWebhook(guild, logEmbed);
            return interaction.editReply({ embeds: [createSuccessEmbed(targetUser.tag + " infracted.")] });
        }

        // ---------- Moderation ----------
        if (command === "mute") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const target = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [createErrorEmbed("Not found.")], ephemeral: true });
            if (isExempt(target)) return interaction.reply({ embeds: [createErrorEmbed("Exempt.")], ephemeral: true });
            if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [createErrorEmbed("Hierarchy.")], ephemeral: true });
            const durationInput = interaction.options.getString("duration");
            const duration = parseDuration(durationInput);
            if (!duration) return interaction.reply({ embeds: [createErrorEmbed("Invalid duration.")], ephemeral: true });
            const limit = getLimitData(guild.id, interaction.user.id);
            if (limit.mutes >= DAILY_LIMIT) return interaction.reply({ embeds: [createErrorEmbed("Daily limit.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                await target.timeout(duration, reason);
                limit.mutes++; saveConfig();
                const embed = createLogEmbed("Member Muted", "**User:** " + target + "\n**Mod:** " + interaction.user + "\n**Duration:** " + durationInput + "\n**Reason:** " + reason);
                await sendLog(guild, embed); await sendWebhook(guild, embed);
                return interaction.reply({ embeds: [createSuccessEmbed(target + " muted.")] });
            } catch (e) { return interaction.reply({ embeds: [createErrorEmbed("Failed.")], ephemeral: true }); }
        }
        if (command === "unmute") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const t = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
            if (!t) return interaction.reply({ embeds: [createErrorEmbed("Not found.")], ephemeral: true });
            try {
                await t.timeout(null, interaction.options.getString("reason") || "No reason provided");
                const embed = createLogEmbed("Member Unmuted", "**User:** " + t + "\n**Mod:** " + interaction.user);
                await sendLog(guild, embed); await sendWebhook(guild, embed);
                return interaction.reply({ embeds: [createSuccessEmbed("Unmuted.")] });
            } catch (e) { return interaction.reply({ embeds: [createErrorEmbed("Failed.")], ephemeral: true }); }
        }
        if (command === "kick") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const t = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
            if (!t) return interaction.reply({ embeds: [createErrorEmbed("Not found.")], ephemeral: true });
            if (isExempt(t)) return interaction.reply({ embeds: [createErrorEmbed("Exempt.")], ephemeral: true });
            if (!canModerate(interaction.member, t)) return interaction.reply({ embeds: [createErrorEmbed("Hierarchy.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                await t.kick(reason);
                const embed = createLogEmbed("Member Kicked", "**User:** " + t.user.tag + "\n**Mod:** " + interaction.user + "\n**Reason:** " + reason);
                await sendLog(guild, embed); await sendWebhook(guild, embed);
                return interaction.reply({ embeds: [createSuccessEmbed("Kicked.")] });
            } catch (e) { return interaction.reply({ embeds: [createErrorEmbed("Failed.")], ephemeral: true }); }
        }
        if (command === "ban") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const t = await guild.members.fetch(interaction.options.getUser("user").id).catch(() => null);
            if (!t) return interaction.reply({ embeds: [createErrorEmbed("Not found.")], ephemeral: true });
            if (isExempt(t)) return interaction.reply({ embeds: [createErrorEmbed("Exempt.")], ephemeral: true });
            if (!canModerate(interaction.member, t)) return interaction.reply({ embeds: [createErrorEmbed("Hierarchy.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                await t.ban({ reason });
                const embed = createLogEmbed("Member Banned", "**User:** " + t.user.tag + "\n**Mod:** " + interaction.user + "\n**Reason:** " + reason);
                await sendLog(guild, embed); await sendWebhook(guild, embed);
                return interaction.reply({ embeds: [createSuccessEmbed("Banned.")] });
            } catch (e) { return interaction.reply({ embeds: [createErrorEmbed("Failed.")], ephemeral: true }); }
        }
        if (command === "unban") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const userId = interaction.options.getString("userid");
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                const u = await client.users.fetch(userId);
                await guild.members.unban(userId, reason);
                const embed = createLogEmbed("Member Unbanned", "**User:** " + u.tag + "\n**Mod:** " + interaction.user + "\n**Reason:** " + reason);
                await sendLog(guild, embed); await sendWebhook(guild, embed);
                return interaction.reply({ embeds: [createSuccessEmbed("Unbanned.")] });
            } catch (e) { return interaction.reply({ embeds: [createErrorEmbed("Failed.")], ephemeral: true }); }
        }

        if (command === "loguser") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const username = interaction.options.getString("username");
            const punishment = interaction.options.getString("punishment");
            const reason = interaction.options.getString("reason");
            await interaction.deferReply();
            const robloxData = await lookupRobloxUser(username);
            const logEmbed = new EmbedBuilder().setTitle("Punishment Log").setColor(0xED4245)
                .addFields(
                    { name: "Roblox Username", value: robloxData ? robloxData.username : username, inline: true },
                    { name: "Roblox ID", value: robloxData ? String(robloxData.id) : "Not found", inline: true },
                    { name: "Punishment", value: punishment, inline: true },
                    { name: "Mod", value: interaction.user.tag, inline: true },
                    { name: "Reason", value: reason, inline: false }
                ).setTimestamp();
            if (robloxData?.avatarUrl) logEmbed.setThumbnail(robloxData.avatarUrl);
            await sendStaffLog(guild, logEmbed); await sendLog(guild, logEmbed); await sendWebhook(guild, logEmbed);
            return interaction.editReply({ embeds: [createSuccessEmbed("Recorded.")] });
        }

        if (command === "suggest") {
            if (!gc.suggestionChannelId) return interaction.reply({ embeds: [createErrorEmbed("Suggestions channel not set.")], ephemeral: true });
            const suggestion = interaction.options.getString("suggestion");
            const ch = guild.channels.cache.get(gc.suggestionChannelId);
            if (!ch) return interaction.reply({ embeds: [createErrorEmbed("Not found.")], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const sentMessage = await ch.send({ embeds: [buildSuggestionEmbed(suggestion, interaction.user, 0, 0)], components: [buildVoteRow("pending", "suggestion")] });
            await sentMessage.edit({ embeds: [buildSuggestionEmbed(suggestion, interaction.user, 0, 0)], components: [buildVoteRow(sentMessage.id, "suggestion")] });
            gc.suggestions[sentMessage.id] = { authorId: interaction.user.id, content: suggestion, upvotes: [], downvotes: [], createdAt: Date.now() };
            saveConfig();
            return interaction.editReply({ embeds: [createSuccessEmbed("Submitted!")] });
        }

        if (command === "staff-feedback") {
            if (!gc.staffFeedbackChannelId) return interaction.reply({ embeds: [createErrorEmbed("Staff feedback channel not set.")], ephemeral: true });
            const staffMember = interaction.options.getUser("staff");
            const feedback = interaction.options.getString("feedback");
            const ch = guild.channels.cache.get(gc.staffFeedbackChannelId);
            if (!ch) return interaction.reply({ embeds: [createErrorEmbed("Not found.")], ephemeral: true });
            await interaction.deferReply({ ephemeral: true });
            const sentMessage = await ch.send({ embeds: [buildStaffFeedbackEmbed(staffMember, feedback, interaction.user, 0, 0)], components: [buildVoteRow("pending", "feedback")] });
            await sentMessage.edit({ embeds: [buildStaffFeedbackEmbed(staffMember, feedback, interaction.user, 0, 0)], components: [buildVoteRow(sentMessage.id, "feedback")] });
            gc.staffFeedback[sentMessage.id] = { authorId: interaction.user.id, staffId: staffMember.id, content: feedback, upvotes: [], downvotes: [], createdAt: Date.now() };
            saveConfig();
            return interaction.editReply({ embeds: [createSuccessEmbed("Submitted!")] });
        }

        if (command === "help") {
            const prefix = getPrefix(guild.id);
            const embed = new EmbedBuilder().setTitle(guild.name + " — Bot Commands V.1.4.1")
                .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: "Setup", value: ["`/setup`", "`/setupverify`", "`/setuptickets`"].join("\n") },
                    { name: "Anti-Nuke", value: ["`/antinuke status`", "`/antinuke enable|disable`", "`/antinuke threshold <n>`", "`/antinuke whitelist-add|remove|list`", "`/antinuke watchlist`", "`/antinuke unwatch <user>`", "`/antinuke reset`"].join("\n") },
                    { name: "HR", value: ["`/acceptsetup`", "`/accept`", "`/promote`", "`/demote`", "`/infract`"].join("\n") },
                    { name: "Moderation", value: ["`/mute`", "`/unmute`", "`/kick`", "`/ban`", "`/unban`"].join("\n") },
                    { name: "Other", value: ["`/suggest`", "`/staff-feedback`", "`/loguser`", "`" + prefix + "loguser`"].join("\n") }
                );
            return interaction.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error("Interaction error:", error);
        try {
            if (interaction.replied || interaction.deferred) await interaction.followUp({ embeds: [createErrorEmbed("An error occurred.")], ephemeral: true });
            else await interaction.reply({ embeds: [createErrorEmbed("An error occurred.")], ephemeral: true });
        } catch (e) { console.error(e); }
    }
});

// ==========================================
// BUTTON HANDLER
// ==========================================

async function handleButton(interaction) {
    const id = interaction.customId;
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);

    if (id === "setup_back") return updateSetupMessage(interaction, "main");
    if (id === "setup_channels") return updateSetupMessage(interaction, "channels");
    if (id === "setup_roles") return updateSetupMessage(interaction, "roles");
    if (id === "setup_tickets") return updateSetupMessage(interaction, "tickets");
    if (id === "setup_dm_templates") return updateSetupMessage(interaction, "templates");
    if (id === "setup_antinuke") return updateSetupMessage(interaction, "antinuke");

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
            embeds: [createInfoEmbed("Choose a channel for **" + cfg.name + "**:")],
            components: [new ActionRowBuilder().addComponents(
                new ChannelSelectMenuBuilder().setCustomId("select_channel_" + cfg.key).setPlaceholder("Pick a channel").setChannelTypes([ChannelType.GuildText, ChannelType.GuildAnnouncement])
            )]
        });
    }

    const roleMap = {
        setup_role_staff: { key: "staffRoles", name: "Staff Roles", single: false },
        setup_role_admin: { key: "adminRoles", name: "Admin Roles", single: false },
        setup_role_management: { key: "managementRoles", name: "Management Roles", single: false },
        setup_role_exempt: { key: "exemptRoles", name: "Exempt Roles", single: false },
        setup_role_verify: { key: "verifyRoleId", name: "Verify Role", single: true },
        setup_role_accept: { key: "acceptRoleIds", name: "Accept Roles", single: false }
    };
    if (roleMap[id]) {
        const cfg = roleMap[id];
        return interaction.update({
            embeds: [createInfoEmbed("Choose roles for **" + cfg.name + "**:")],
            components: [new ActionRowBuilder().addComponents(
                new RoleSelectMenuBuilder().setCustomId("select_role_" + cfg.key).setPlaceholder("Pick roles").setMaxValues(cfg.single ? 1 : 10)
            )]
        });
    }

    if (id === "setup_clear_staff") { gc.staffRoles = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_admin") { gc.adminRoles = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_management") { gc.managementRoles = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_exempt") { gc.exemptRoles = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_accept") { gc.acceptRoleIds = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }

    if (id === "setup_ticket_support_cat") return interaction.update({ embeds: [createInfoEmbed("Choose the **Support Tickets Category**:")], components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("select_ticketcat_support").setPlaceholder("Pick a category").setChannelTypes([ChannelType.GuildCategory]))] });
    if (id === "setup_ticket_high_cat") return interaction.update({ embeds: [createInfoEmbed("Choose the **High Rank Tickets Category**:")], components: [new ActionRowBuilder().addComponents(new ChannelSelectMenuBuilder().setCustomId("select_ticketcat_highrank").setPlaceholder("Pick a category").setChannelTypes([ChannelType.GuildCategory]))] });
    if (id === "setup_ticket_support_ping") return interaction.update({ embeds: [createInfoEmbed("Choose the **Support Ping Role**:")], components: [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId("select_ticketping_support").setPlaceholder("Pick a role").setMaxValues(1))] });
    if (id === "setup_ticket_high_ping") return interaction.update({ embeds: [createInfoEmbed("Choose the **High Rank Ping Role**:")], components: [new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId("select_ticketping_highrank").setPlaceholder("Pick a role").setMaxValues(1))] });
    if (id === "setup_ticket_ping_management") {
        if (!gc.managementRoles.length) return interaction.reply({ embeds: [createErrorEmbed("Set Management roles first.")], ephemeral: true });
        gc.ticketHighRankPingRoleId = gc.managementRoles[0]; saveConfig();
        return updateSetupMessage(interaction, "tickets");
    }

    if (id === "setup_an_toggle") { gc.antinuke.enabled = !gc.antinuke.enabled; saveConfig(); return updateSetupMessage(interaction, "antinuke"); }
    if (id === "setup_an_threshold") {
        const modal = new ModalBuilder().setCustomId("modal_an_threshold").setTitle("Set Anti-Nuke Threshold");
        modal.addComponents(new ActionRowBuilder().addComponents(
            new TextInputBuilder().setCustomId("threshold").setLabel("Trigger after this many events (2-20)").setStyle(TextInputStyle.Short).setValue(String(gc.antinuke.threshold)).setRequired(true)
        ));
        return interaction.showModal(modal);
    }
    if (id === "setup_an_whitelist") return interaction.update({ embeds: [createInfoEmbed("Choose a user to **whitelist**:")], components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("select_an_whitelist_add").setPlaceholder("Pick a user").setMaxValues(1))] });
    if (id === "setup_an_unwhitelist") return interaction.update({ embeds: [createInfoEmbed("Choose a user to **unwhitelist**:")], components: [new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId("select_an_whitelist_remove").setPlaceholder("Pick a user").setMaxValues(1))] });
    if (id === "setup_an_list") {
        const list = gc.antinuke.whitelist.length ? gc.antinuke.whitelist.map(id => "<@" + id + ">").join(", ") : "None";
        return interaction.reply({ embeds: [createInfoEmbed("**Whitelisted:** " + list)], ephemeral: true });
    }
    if (id === "setup_an_watchlist") {
        const now = Date.now();
        const entries = Object.entries(gc.antinuke.watchlist).filter(([, e]) => e > now);
        if (!entries.length) return interaction.reply({ embeds: [createInfoEmbed("No users on rejoin watch.")], ephemeral: true });
        const lines = entries.map(([uid, e]) => "• <@" + uid + "> — expires <t:" + Math.floor(e / 1000) + ":R>");
        return interaction.reply({ embeds: [createInfoEmbed("**Rejoin Watch:**\n" + lines.join("\n"))], ephemeral: true });
    }
    if (id === "setup_an_reset") { gc.antinuke.counters = {}; saveConfig(); return updateSetupMessage(interaction, "antinuke"); }

    if (id === "setup_post_verify") {
        await interaction.channel.send({ embeds: [buildVerifyEmbed(guild)], components: buildVerifyRows() });
        return interaction.reply({ embeds: [createSuccessEmbed("Verification panel posted.")], ephemeral: true });
    }
    if (id === "setup_post_tickets") {
        await interaction.channel.send({ embeds: [buildTicketPanelEmbed(guild)], components: buildTicketPanelRows() });
        return interaction.reply({ embeds: [createSuccessEmbed("Ticket panel posted.")], ephemeral: true });
    }

    const tplMap = {
        setup_tpl_accept: { key: "accept", name: "Accept DM", label: "Vars: {server} {notes}" },
        setup_tpl_promote: { key: "promote", name: "Promote DM", label: "Vars: {server} {rank} {notes}" },
        setup_tpl_demote: { key: "demote", name: "Demote DM", label: "Vars: {server} {rank} {notes}" },
        setup_tpl_infract: { key: "infract", name: "Infract DM", label: "Vars: {server} {type} {reason} {notes}" }
    };
    if (tplMap[id]) {
        const cfg = tplMap[id];
        const currentValue = gc.dmTemplates[cfg.key] || "";
        const safeValue = currentValue.length > 2000 ? currentValue.slice(0, 2000) : currentValue;
        const modal = new ModalBuilder().setCustomId("modal_tpl_" + cfg.key).setTitle("Edit " + cfg.name);
        const input = new TextInputBuilder().setCustomId("template").setLabel(cfg.label.slice(0, 45)).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(2000);
        if (safeValue) input.setValue(safeValue);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    if (id.startsWith("vote_")) return handleVoteButton(interaction);
    if (id === "verify_start") return handleVerifyStart(interaction);
    if (id === "verify_check") return handleVerifyCheck(interaction);
    if (id === "verify_help") return handleTicketCreate(interaction, "support", "User clicked **I Can't Verify** on the verification panel.");
    if (id === "ticket_open_menu") return interaction.reply({ embeds: [createInfoEmbed("**Which support do you need?**")], components: buildTicketTypeRows(), ephemeral: true });
    if (id === "ticket_rules") return interaction.reply({ embeds: [buildTicketRulesEmbed(guild)], ephemeral: true });
    if (id === "ticket_type_support") return handleTicketCreate(interaction, "support");
    if (id === "ticket_type_highrank") return handleTicketCreate(interaction, "highrank");
    if (id === "ticket_close") return handleTicketClose(interaction);
}

// ==========================================
// SELECT HANDLER
// ==========================================

async function handleSelect(interaction) {
    const id = interaction.customId;
    const gc = getGuildConfig(interaction.guild.id);

    if (id.startsWith("select_channel_")) {
        gc[id.slice("select_channel_".length)] = interaction.values[0];
        saveConfig();
        return updateSetupMessage(interaction, "channels");
    }
    if (id.startsWith("select_role_")) {
        const key = id.slice("select_role_".length);
        const values = interaction.values;
        if (key === "verifyRoleId") gc.verifyRoleId = values[0];
        else for (const rid of values) if (!gc[key].includes(rid)) gc[key].push(rid);
        saveConfig();
        return updateSetupMessage(interaction, "roles");
    }
    if (id === "select_ticketcat_support") { gc.ticketSupportCategoryId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_ticketcat_highrank") { gc.ticketHighRankCategoryId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_ticketping_support") { gc.ticketSupportPingRoleId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_ticketping_highrank") { gc.ticketHighRankPingRoleId = interaction.values[0]; saveConfig(); return updateSetupMessage(interaction, "tickets"); }
    if (id === "select_an_whitelist_add") { const uid = interaction.values[0]; if (!gc.antinuke.whitelist.includes(uid)) gc.antinuke.whitelist.push(uid); saveConfig(); return updateSetupMessage(interaction, "antinuke"); }
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
        if (/\s/.test(prefix)) return interaction.reply({ embeds: [createErrorEmbed("No spaces.")], ephemeral: true });
        gc.prefix = prefix; saveConfig();
        return interaction.reply({ embeds: [createSuccessEmbed("Prefix: `" + prefix + "`.")], ephemeral: true });
    }
    if (id === "modal_webhook") {
        const url = interaction.fields.getTextInputValue("url");
        if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(url)) return interaction.reply({ embeds: [createErrorEmbed("Invalid URL.")], ephemeral: true });
        gc.webhookUrl = url; saveConfig();
        return interaction.reply({ embeds: [createSuccessEmbed("Webhook saved.")], ephemeral: true });
    }
    if (id.startsWith("modal_tpl_")) {
        const key = id.slice("modal_tpl_".length);
        const value = interaction.fields.getTextInputValue("template");
        gc.dmTemplates[key] = value; saveConfig();
        const preview = new EmbedBuilder().setTitle("✅ Template Updated: " + key).setDescription("**New template:**\n" + value).setColor(0x57F287).setTimestamp();
        return interaction.reply({ embeds: [preview], ephemeral: true });
    }
    if (id === "modal_an_threshold") {
        const raw = interaction.fields.getTextInputValue("threshold").trim();
        const n = parseInt(raw, 10);
        if (isNaN(n) || n < 2 || n > 20) return interaction.reply({ embeds: [createErrorEmbed("Enter a number between 2 and 20.")], ephemeral: true });
        gc.antinuke.threshold = n; saveConfig();
        return interaction.reply({ embeds: [createSuccessEmbed("Threshold: **" + n + "**.")], ephemeral: true });
    }
    if (id === "modal_verify_username") {
        const username = interaction.fields.getTextInputValue("username").trim();
        const robloxData = await lookupRobloxUser(username);
        if (!robloxData) return interaction.reply({ embeds: [createErrorEmbed("Could not find Roblox username.")], ephemeral: true });
        const code = generateCode();
        gc.verifySessions[interaction.user.id] = { code, robloxId: robloxData.id, robloxUsername: robloxData.username, createdAt: Date.now() };
        saveConfig();
        const embed = new EmbedBuilder().setTitle("Verification Code")
            .setDescription("**Step 1:** Open your profile: [Click here](" + robloxData.profileUrl + ")\n**Step 2:** Paste this into your **About** and save:\n\n`" + code + "`\n\n**Step 3:** Return and click **Check Verification**.")
            .setColor(WEBHOOK_COLOR).setThumbnail(robloxData.avatarUrl || guild.iconURL({ dynamic: true })).setTimestamp();
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
    if (!session) return interaction.reply({ embeds: [createErrorEmbed("No active session.")], ephemeral: true });
    await interaction.deferReply({ ephemeral: true });
    const robloxData = await lookupRobloxUser(session.robloxUsername);
    if (!robloxData) return interaction.editReply({ embeds: [createErrorEmbed("Fetch failed.")] });
    if (!robloxData.description.includes(session.code)) return interaction.editReply({ embeds: [createErrorEmbed("Code not found in profile.")] });
    gc.verifiedUsers[interaction.user.id] = { robloxId: robloxData.id, robloxUsername: robloxData.username, verifiedAt: Date.now() };
    delete gc.verifySessions[interaction.user.id];
    saveConfig();
    let roleGiven = false;
    if (gc.verifyRoleId) { try { await interaction.member.roles.add(gc.verifyRoleId, "Verified"); roleGiven = true; } catch (e) {} }
    const successEmbed = new EmbedBuilder().setTitle("✅ Verification Successful").setDescription("Welcome, **" + robloxData.username + "**! You have been verified.").setColor(0x57F287).setThumbnail(robloxData.avatarUrl || null).setTimestamp();
    const logEmbed = new EmbedBuilder().setTitle("User Verified").setColor(WEBHOOK_COLOR)
        .addFields(
            { name: "Discord", value: interaction.user.tag + " (" + interaction.user.id + ")", inline: true },
            { name: "Roblox", value: robloxData.username + " (" + robloxData.id + ")", inline: true },
            { name: "Role Given", value: roleGiven ? "Yes" : "No", inline: true }
        ).setThumbnail(robloxData.avatarUrl || null).setTimestamp();
    await sendVerificationLog(guild, logEmbed);
    await sendLog(guild, logEmbed);
    await sendWebhook(guild, logEmbed);
    return interaction.editReply({ embeds: [successEmbed] });
}

// ==========================================
// TICKETS
// ==========================================

const TICKET_TYPES = {
    support: { label: "General Support", slug: "general-support", emoji: "⚙️", categoryKey: "ticketSupportCategoryId", pingKey: "ticketSupportPingRoleId" },
    highrank: { label: "High Rank", slug: "high-rank", emoji: "🛡️", categoryKey: "ticketHighRankCategoryId", pingKey: "ticketHighRankPingRoleId" }
};

async function handleTicketCreate(interaction, type, prefillReason) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    const cfg = TICKET_TYPES[type];
    if (!cfg) return interaction.reply({ embeds: [createErrorEmbed("Unknown ticket type.")], ephemeral: true });

    const existing = Object.entries(gc.tickets).find(([, t]) => t.userId === interaction.user.id && t.open);
    if (existing) {
        const ch = guild.channels.cache.get(existing[0]);
        return interaction.reply({ embeds: [createErrorEmbed(ch ? "You have an open ticket: " + ch : "You already have an open ticket.")], ephemeral: true });
    }
    const categoryId = gc[cfg.categoryKey];
    if (!categoryId) return interaction.reply({ embeds: [createErrorEmbed("Category not set. Configure in `/setup → Tickets`.")], ephemeral: true });
    const category = guild.channels.cache.get(categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) return interaction.reply({ embeds: [createErrorEmbed("Category missing.")], ephemeral: true });

    if (!interaction.deferred && !interaction.replied) await interaction.deferReply({ ephemeral: true });
    const ticketNumber = (gc.ticketCounter || 0) + 1;
    gc.ticketCounter = ticketNumber;
    const cleanUser = interaction.user.username.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 15) || "user";
    const channelName = ticketNumber + "-" + cfg.slug + "-" + cleanUser;

    const overwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
        { id: client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ReadMessageHistory] }
    ];
    const viewRoleIds = new Set([...gc.staffRoles, ...gc.adminRoles, ...gc.managementRoles]);
    if (gc[cfg.pingKey]) viewRoleIds.add(gc[cfg.pingKey]);
    for (const rid of viewRoleIds) if (!overwrites.find(o => o.id === rid)) overwrites.push({ id: rid, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });

    let channel;
    try {
        channel = await guild.channels.create({
            name: channelName, type: ChannelType.GuildText, parent: categoryId,
            permissionOverwrites: overwrites,
            topic: "Ticket #" + ticketNumber + " • " + cfg.label + " • " + interaction.user.tag
        });
    } catch (e) { console.error(e); return interaction.editReply({ embeds: [createErrorEmbed("Could not create.")] }); }

    gc.tickets[channel.id] = { userId: interaction.user.id, type, number: ticketNumber, name: cfg.slug, open: true, createdAt: Date.now() };
    saveConfig();

    const pingIds = new Set();
    if (gc[cfg.pingKey]) pingIds.add(gc[cfg.pingKey]);
    if (type === "highrank") for (const rid of gc.managementRoles) pingIds.add(rid);
    const pingStr = [...pingIds].map(id => "<@&" + id + ">").join(" ");

    const welcomeEmbed = new EmbedBuilder()
        .setTitle(cfg.emoji + " " + cfg.label + " — Ticket #" + ticketNumber)
        .setDescription("**" + interaction.user + "**, thank you for opening a ticket.\n\n" + (prefillReason ? "**Reason:** " + prefillReason + "\n\n" : "") + "A staff member will assist you shortly.")
        .setColor(WEBHOOK_COLOR).setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined }).setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
    );

    await channel.send({ content: interaction.user + (pingStr ? " " + pingStr : ""), embeds: [welcomeEmbed], components: [closeRow] }).catch(e => console.error(e));

    const logEmbed = new EmbedBuilder().setTitle("Ticket Opened").setColor(WEBHOOK_COLOR)
        .addFields(
            { name: "Ticket #", value: String(ticketNumber), inline: true },
            { name: "Type", value: cfg.label, inline: true },
            { name: "User", value: interaction.user.tag, inline: true },
            { name: "Channel", value: channel.toString(), inline: false }
        ).setTimestamp();
    await sendTicketLog(guild, logEmbed);
    await sendWebhook(guild, logEmbed);
    return interaction.editReply({ embeds: [createSuccessEmbed("Ticket created: " + channel)] });
}

async function handleTicketClose(interaction) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    const ticket = gc.tickets[interaction.channel.id];
    if (!ticket) return interaction.reply({ embeds: [createErrorEmbed("Not a ticket.")], ephemeral: true });
    const isOwner = interaction.user.id === ticket.userId;
    if (!isOwner && !isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Only owner or staff.")], ephemeral: true });
    await interaction.reply({ embeds: [createInfoEmbed("🔒 Closing and generating transcript...")] });
    try {
        const messages = await interaction.channel.messages.fetch({ limit: 500 });
        const sorted = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
        let text = "=== Ticket #" + ticket.number + " Transcript ===\nType: " + ticket.type + "\nUser ID: " + ticket.userId + "\nClosed by: " + interaction.user.tag + " (" + interaction.user.id + ")\nClosed at: " + new Date().toISOString() + "\n======================================\n\n";
        for (const m of sorted) {
            text += "[" + new Date(m.createdTimestamp).toISOString() + "] " + m.author.tag + ": " + (m.content || "<no text>") + "\n";
            if (m.attachments.size) for (const a of m.attachments.values()) text += "   [attachment] " + a.url + "\n";
        }
        const attachment = new AttachmentBuilder(Buffer.from(text, "utf8"), { name: "transcript-" + ticket.number + "-" + ticket.type + ".txt" });
        const transcriptEmbed = new EmbedBuilder().setTitle("Ticket Transcript — #" + ticket.number).setColor(WEBHOOK_COLOR)
            .addFields(
                { name: "Type", value: ticket.type, inline: true },
                { name: "Owner", value: "<@" + ticket.userId + ">", inline: true },
                { name: "Closed By", value: interaction.user.tag, inline: true }
            ).setTimestamp();
        await sendTranscript(guild, attachment, transcriptEmbed);
    } catch (e) { console.error("transcript:", e); }
    ticket.open = false; ticket.closedAt = Date.now(); ticket.closedBy = interaction.user.id; saveConfig();
    const logEmbed = new EmbedBuilder().setTitle("Ticket Closed").setColor(0xED4245)
        .addFields(
            { name: "Ticket #", value: String(ticket.number), inline: true },
            { name: "Type", value: ticket.type, inline: true },
            { name: "Closed By", value: interaction.user.tag, inline: true }
        ).setTimestamp();
    await sendTicketLog(guild, logEmbed);
    await sendWebhook(guild, logEmbed);
    setTimeout(async () => { try { await interaction.channel.delete("Ticket closed"); } catch (e) {} }, 5000);
}

// ==========================================
// VOTES / EMBEDS
// ==========================================

async function handleVoteButton(interaction) {
    try {
        const parts = interaction.customId.split("_");
        if (parts.length < 4) return interaction.reply({ embeds: [createErrorEmbed("Invalid.")], ephemeral: true });
        const direction = parts[1], type = parts[2], messageId = parts[3];
        const gc = getGuildConfig(interaction.guild.id);
        const store = type === "suggestion" ? gc.suggestions : gc.staffFeedback;
        if (!store[messageId]) return interaction.reply({ embeds: [createErrorEmbed("Invalid vote.")], ephemeral: true });
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
            const staffMember = await client.users.fetch(data.staffId).catch(() => null) || { id: data.staffId };
            const author = await client.users.fetch(data.authorId).catch(() => null) || { id: data.authorId };
            updatedEmbed = buildStaffFeedbackEmbed(staffMember, data.content, author, data.upvotes.length, data.downvotes.length);
        }
        await interaction.message.edit({ embeds: [updatedEmbed], components: [buildVoteRow(messageId, type)] });
        return interaction.reply({ embeds: [createSuccessEmbed("Voted.")], ephemeral: true });
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
// PANEL EMBEDS
// ==========================================

function buildVerifyEmbed(guild) {
    return new EmbedBuilder().setTitle("Verification Required")
        .setDescription(
            "**Welcome to " + guild.name + ".**\n\nPlease complete Roblox verification to unlock access to all channels.\n\n" +
            "**How to verify:**\n> 1. Click **Verify** below.\n> 2. Enter your Roblox username.\n> 3. Paste the code into your Roblox About section.\n> 4. Return and click **Check Verification**.\n\n" +
            "**Need help?**\n> Click **I Can't Verify** to open a support ticket."
        )
        .setColor(EMBED_ACCENT).setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
        .setFooter({ text: guild.name + " • Verification System", iconURL: guild.iconURL({ dynamic: true }) || undefined }).setTimestamp();
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
        .setColor(EMBED_ACCENT).setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
        .setFooter({ text: guild.name + " • Support System", iconURL: guild.iconURL({ dynamic: true }) || undefined }).setTimestamp();
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
        .setColor(EMBED_ACCENT).setFooter({ text: guild.name + " • Ticket Rules", iconURL: guild.iconURL({ dynamic: true }) || undefined }).setTimestamp();
}

// ==========================================
// PREFIX COMMANDS
// ==========================================

client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (!message.guild) return;
    const prefix = getPrefix(message.guild.id);
    if (!message.content.startsWith(prefix)) return;
    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = (args.shift() || "").toLowerCase();
    if (!command) return;
    const guild = message.guild;
    try {
        if (command === "help") {
            const embed = new EmbedBuilder().setTitle(guild.name + " — Prefix Commands").setColor(WEBHOOK_COLOR)
                .addFields({ name: "Prefix Commands", value: ["`" + prefix + "help`", "`" + prefix + "loguser <username> <punishment> <reason>`"].join("\n") });
            return message.reply({ embeds: [embed] });
        }
        if (command === "loguser") {
            if (!isStaff(message.member)) return message.reply({ embeds: [createErrorEmbed("Staff only.")] });
            const username = args[0], punishment = args[1], reason = args.slice(2).join(" ");
            if (!username || !punishment || !reason) return message.reply({ embeds: [createErrorEmbed("Usage: `" + prefix + "loguser <username> <punishment> <reason>`")] });
            await message.channel.sendTyping();
            const robloxData = await lookupRobloxUser(username);
            const logEmbed = new EmbedBuilder().setTitle("Punishment Log").setColor(0xED4245)
                .addFields(
                    { name: "Roblox Username", value: robloxData ? robloxData.username : username, inline: true },
                    { name: "Roblox ID", value: robloxData ? String(robloxData.id) : "Not found", inline: true },
                    { name: "Punishment", value: punishment, inline: true },
                    { name: "Mod", value: message.author.tag, inline: true },
                    { name: "Reason", value: reason, inline: false }
                ).setTimestamp();
            if (robloxData?.avatarUrl) logEmbed.setThumbnail(robloxData.avatarUrl);
            await sendStaffLog(guild, logEmbed); await sendLog(guild, logEmbed); await sendWebhook(guild, logEmbed);
            return message.reply({ embeds: [createSuccessEmbed("Recorded.")] });
        }
    } catch (e) { console.error(e); try { await message.reply({ embeds: [createErrorEmbed("Error.")] }); } catch (x) {} }
});

// ==========================================
// MEMBER JOIN — WELCOME + REJOIN WATCH
// ==========================================

client.on("guildMemberAdd", async member => {
    try {
        const guild = member.guild;
        const gc = getGuildConfig(guild.id);

        // ---- CHECK REJOIN WATCH FIRST ----
        const wasMuted = await checkRejoinWatch(member);

        // ---- WELCOME (still sent so they see context) ----
        if (gc.welcomeChannelId) {
            const ch = guild.channels.cache.get(gc.welcomeChannelId);
            if (ch) {
                const n = guild.memberCount;
                await ch.send({ content: member.toString() + " Hello, and welcome to **" + guild.name + "**! You are our **" + n + getOrdinalSuffix(n) + "** member, enjoy your stay!" });
            }
        }

        // ---- LOG ----
        const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
        const embed = createLogEmbed("Member Joined",
            "**User:** " + member + " (" + member.user.tag + ")\n**ID:** " + member.id + "\n**Account Age:** " + accountAge + " days\n**Member Count:** " + guild.memberCount + (wasMuted ? "\n\n⚠️ **Auto-muted (24h rejoin watch)**" : ""),
            wasMuted ? 0xED4245 : 0x57F287);
        await sendLog(guild, embed);
        await sendWebhook(guild, embed);
    } catch (e) { console.error("guildMemberAdd:", e); }
});

client.on("guildMemberRemove", async member => {
    try {
        const embed = createLogEmbed("Member Left", "**User:** " + member.user.tag + "\n**ID:** " + member.id, 0xED4245);
        await sendLog(member.guild, embed);
        await sendWebhook(member.guild, embed);

        // Antinuke: kick detection
        if (!member.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const executor = await fetchAuditExecutor(member.guild, 20 /* MEMBER_KICK */, member.id);
        if (executor) await handleAntinukeEvent(member.guild, executor.id, "Kick");
    } catch (e) { console.error(e); }
});

// ==========================================
// ANTI-NUKE EVENT HOOKS
// ==========================================

client.on("channelDelete", async channel => {
    try {
        if (!channel.guild) return;
        await sendLog(channel.guild, createLogEmbed("Channel Deleted", "**Name:** " + channel.name + "\n**ID:** " + channel.id, 0xED4245));
        if (!channel.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const executor = await fetchAuditExecutor(channel.guild, 12, channel.id);
        if (executor) await handleAntinukeEvent(channel.guild, executor.id, "Channel Delete");
    } catch (e) { console.error("channelDelete:", e); }
});

client.on("roleDelete", async role => {
    try {
        await sendLog(role.guild, createLogEmbed("Role Deleted", "**Role:** " + role.name + "\n**ID:** " + role.id, 0xED4245));
        if (!role.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const executor = await fetchAuditExecutor(role.guild, 32, role.id);
        if (executor) await handleAntinukeEvent(role.guild, executor.id, "Role Delete");
    } catch (e) { console.error("roleDelete:", e); }
});

client.on("guildBanAdd", async ban => {
    try {
        await sendLog(ban.guild, createLogEmbed("Member Banned", "**User:** " + ban.user.tag + "\n**ID:** " + ban.user.id + "\n**Reason:** " + (ban.reason || "None"), 0xED4245));
        await sendWebhook(ban.guild, createLogEmbed("Member Banned", "**User:** " + ban.user.tag + "\n**ID:** " + ban.user.id, 0xED4245));
        if (!ban.guild.members.me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return;
        const executor = await fetchAuditExecutor(ban.guild, 22, ban.user.id);
        if (executor) await handleAntinukeEvent(ban.guild, executor.id, "Ban");
    } catch (e) { console.error("guildBanAdd:", e); }
});

// ==========================================
// OTHER LOG EVENTS
// ==========================================

client.on("messageDelete", async message => {
    try {
        if (!message.guild || message.author?.bot) return;
        await sendLog(message.guild, createLogEmbed("Message Deleted",
            "**Author:** " + (message.author?.tag || "Unknown") + "\n**Channel:** " + message.channel + "\n**Content:** " + (message.content || "*None*").slice(0, 1500), 0xED4245));
    } catch (e) { console.error(e); }
});

client.on("messageUpdate", async (o, n) => {
    try {
        if (!o.guild || o.author?.bot || o.content === n.content) return;
        await sendLog(o.guild, createLogEmbed("Message Edited",
            "**Author:** " + (o.author?.tag || "Unknown") + "\n**Channel:** " + o.channel + "\n**Before:** " + (o.content || "*None*").slice(0, 800) + "\n**After:** " + (n.content || "*None*").slice(0, 800), 0xFEE75C));
    } catch (e) { console.error(e); }
});

client.on("roleCreate", async role => {
    try { await sendLog(role.guild, createLogEmbed("Role Created", "**Role:** " + role + "\n**ID:** " + role.id, 0x57F287)); } catch (e) { console.error(e); }
});

client.on("channelCreate", async channel => {
    try { if (!channel.guild) return; await sendLog(channel.guild, createLogEmbed("Channel Created", "**Channel:** " + channel + "\n**Name:** " + channel.name, 0x57F287)); } catch (e) { console.error(e); }
});

client.on("voiceStateUpdate", async (o, n) => {
    try {
        const member = n.member || o.member;
        if (!member) return;
        if (!o.channelId && n.channelId) await sendLog(member.guild, createLogEmbed("Voice Joined", "**User:** " + member + "\n**Channel:** " + n.channel, 0x57F287));
        else if (o.channelId && !n.channelId) await sendLog(member.guild, createLogEmbed("Voice Left", "**User:** " + member + "\n**Channel:** " + o.channel, 0xED4245));
        else if (o.channelId !== n.channelId) await sendLog(member.guild, createLogEmbed("Voice Switched", "**User:** " + member + "\n**From:** " + o.channel + "\n**To:** " + n.channel, 0xFEE75C));
    } catch (e) { console.error(e); }
});

// ==========================================
// GLOBAL ERROR HANDLING
// ==========================================

client.on("error", e => console.error("Discord client error:", e));
client.on("warn", w => console.warn("Discord client warning:", w));
process.on("unhandledRejection", e => console.error("Unhandled promise rejection:", e));
process.on("uncaughtException", e => console.error("Uncaught exception:", e));

// ==========================================
// LOGIN
// ==========================================

client.login(TOKEN);