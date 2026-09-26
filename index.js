// ==========================================
// EAGLE COUNTY ROLEPLAY BOT - V.1.2.1
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
    WebhookClient
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
const WEBHOOK_COLOR = 0x2563EB; // Blue
const EMBED_ACCENT = 0xFF8C00;  // Orange (matches LA RP panels)

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
        welcomeChannelId: null,
        suggestionChannelId: null,
        staffFeedbackChannelId: null,
        staffLogChannelId: null,
        hrLogChannelId: null,
        verifyChannelId: null,
        verifyRoleId: null,
        ticketCategoryId: null,
        ticketCategoryHighRankId: null,
        ticketLogChannelId: null,
        webhookUrl: null,
        acceptRoleIds: [],
        staffRoles: [],
        adminRoles: [],
        exemptRoles: [],
        dmTemplates: {
            accept: "Congratulations! Your application for **{server}** has been accepted.\n\nPlease review the server for next steps. If you have questions, reach out to a staff member.",
            promote: "You have been **promoted** in **{server}**!\n\n**New Rank:** {rank}",
            demote: "You have been **demoted** in **{server}**.\n\n**New Rank:** {rank}",
            infract: "You have received an infraction in **{server}**.\n\n**Type:** {type}\n**Reason:** {reason}"
        },
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
    if (gc.acceptRoleId && (!gc.acceptRoleIds || gc.acceptRoleIds.length === 0)) {
        gc.acceptRoleIds = [gc.acceptRoleId];
    }
    if (gc.ticketCategoryId && !gc.ticketCategoryHighRankId) {
        gc.ticketCategoryHighRankId = gc.ticketCategoryId;
    }
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
    return hasRole(member, gc.adminRoles) || hasRole(member, gc.staffRoles);
}

function isAdmin(member) {
    if (!member) return false;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
    const gc = getGuildConfig(member.guild.id);
    return hasRole(member, gc.adminRoles);
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

async function sendLog(guild, embed) {
    try {
        const gc = getGuildConfig(guild.id);
        if (!gc.logChannelId) return;
        const channel = guild.channels.cache.get(gc.logChannelId);
        if (!channel) return;
        await channel.send({ embeds: [embed] });
    } catch (e) { console.error("sendLog:", e); }
}

async function sendStaffLog(guild, embed) {
    try {
        const gc = getGuildConfig(guild.id);
        if (!gc.staffLogChannelId) return;
        const channel = guild.channels.cache.get(gc.staffLogChannelId);
        if (!channel) return;
        await channel.send({ embeds: [embed] });
    } catch (e) { console.error("sendStaffLog:", e); }
}

async function sendHRLog(guild, embed) {
    try {
        const gc = getGuildConfig(guild.id);
        if (!gc.hrLogChannelId) return;
        const channel = guild.channels.cache.get(gc.hrLogChannelId);
        if (!channel) return;
        await channel.send({ embeds: [embed] });
    } catch (e) { console.error("sendHRLog:", e); }
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
        const userResponse = await fetch("https://users.roblox.com/v1/usernames/users", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ usernames: [username], excludeBannedUsers: false })
        });
        if (!userResponse.ok) return null;
        const userData = await userResponse.json();
        if (!userData.data || userData.data.length === 0) return null;

        const user = userData.data[0];
        const userId = user.id;

        const detailResponse = await fetch("https://users.roblox.com/v1/users/" + userId);
        if (!detailResponse.ok) return null;
        const details = await detailResponse.json();

        let avatarUrl = null;
        try {
            const avatarResponse = await fetch(
                "https://thumbnails.roblox.com/v1/users/avatar-headshot?userIds=" + userId + "&size=420x420&format=Png&isCircular=false"
            );
            if (avatarResponse.ok) {
                const avatarData = await avatarResponse.json();
                if (avatarData.data && avatarData.data.length > 0) avatarUrl = avatarData.data[0].imageUrl;
            }
        } catch (e) { /* ignore */ }

        return {
            id: userId,
            username: details.name,
            displayName: details.displayName,
            description: details.description || "",
            created: details.created,
            avatarUrl,
            profileUrl: "https://www.roblox.com/users/" + userId + "/profile"
        };
    } catch (error) {
        console.error("Roblox lookup error:", error);
        return null;
    }
}

// ==========================================
// VERIFY EMBED
// ==========================================

function buildVerifyEmbed(guild) {
    return new EmbedBuilder()
        .setTitle("Verification Required")
        .setDescription(
            "**Welcome to " + guild.name + ".**\n\n" +
            "Please complete Roblox verification to unlock access to all channels.\n\n" +
            "**How to verify:**\n" +
            "> 1. Click the **Verify** button below.\n" +
            "> 2. Enter your Roblox username when prompted.\n" +
            "> 3. Paste the code you receive into your Roblox profile's **About** section.\n" +
            "> 4. Return here and click **Check Verification**.\n\n" +
            "**Need help?**\n" +
            "> Click **I Can't Verify** to open a support ticket and a staff member will assist you."
        )
        .setColor(EMBED_ACCENT)
        .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
        .setFooter({ text: guild.name + " • Verification System", iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

function buildVerifyRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("verify_start").setLabel("Verify").setEmoji("✅").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("verify_check").setLabel("Check Verification").setEmoji("🔄").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("verify_help").setLabel("I Can't Verify").setEmoji("❓").setStyle(ButtonStyle.Secondary)
        )
    ];
}

// ==========================================
// TICKET EMBEDS
// ==========================================

function buildTicketPanelEmbed(guild) {
    return new EmbedBuilder()
        .setTitle("🎫 Need Assistance?")
        .setDescription(
            "**" + guild.name + " | Support Assistant**\n\n" +
            "⚙️ **Need Assistance?**\n" +
            "> Click the **Open a Ticket** button below to get started and open a support ticket.\n\n" +
            "ℹ️ **Server Rules**\n" +
            "> Please review the Ticket Rules before proceeding to ensure your request is handled properly."
        )
        .setColor(EMBED_ACCENT)
        .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
        .setFooter({ text: guild.name + " • Support System", iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

function buildTicketPanelRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("ticket_open_menu").setLabel("Open a Ticket").setEmoji("🎫").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("ticket_rules").setLabel("Ticket Rules").setEmoji("📋").setStyle(ButtonStyle.Secondary)
        )
    ];
}

function buildTicketTypeRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("ticket_type_support").setLabel("General Support").setEmoji("⚙️").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("ticket_type_highrank").setLabel("High Rank Tickets").setEmoji("🛡️").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildTicketRulesEmbed(guild) {
    return new EmbedBuilder()
        .setTitle("📋 Ticket Rules")
        .setDescription(
            "**Please follow these rules while using the support system:**\n\n" +
            "**1.** Remain patient and do not ping support roles — someone will assist you as soon as possible.\n" +
            "**2.** Be respectful toward the person helping you.\n" +
            "**3.** Respect the authority and guidance of high-ranking members.\n" +
            "**4.** Do not open tickets for jokes, trolling, or unnecessary reasons.\n" +
            "**5.** Do not open multiple tickets for the same issue.\n" +
            "**6.** Keep all messages relevant to your support request.\n" +
            "**7.** Providing false information may result in punishment or denial of support.\n" +
            "**8.** Do not spam, argue, or cause disruptions inside tickets.\n" +
            "**9.** Follow all server rules while using the support system.\n" +
            "**10.** Staff may close tickets that are inactive, resolved, or deemed unnecessary.\n" +
            "**11.** Attempting to waste staff time intentionally may lead to moderation actions.\n" +
            "**12.** Do not misuse pings, attachments, or embeds inside tickets.\n" +
            "**13.** Any form of harassment, discrimination, or threats toward staff or members will not be tolerated.\n" +
            "**14.** If instructed by staff, cooperate fully to help resolve your issue faster.\n" +
            "**15.** Screenshots, proof, or additional details may be required depending on the report or request."
        )
        .setColor(EMBED_ACCENT)
        .setFooter({ text: guild.name + " • Ticket Rules", iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
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

        new SlashCommandBuilder().setName("setupverify").setDescription("Post the Roblox verification panel in this channel"),
        new SlashCommandBuilder().setName("setuptickets").setDescription("Post the ticket panel in this channel"),

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

        new SlashCommandBuilder().setName("infract").setDescription("Infract a user (warn/strike/suspension)")
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
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true))
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
    client.user.setActivity("Eagle County Roleplay | V.1.2.1");
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
        .setColor(
            templateKey === "demote" || templateKey === "infract" ? 0xED4245 :
            0x57F287
        )
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

function buildSetupEmbed(guild) {
    const gc = getGuildConfig(guild.id);
    const ch = (id) => id ? "<#" + id + ">" : "Not set";
    const roleList = (arr) => arr && arr.length ? arr.map(id => "<@&" + id + ">").join(", ") : "None";

    return new EmbedBuilder()
        .setTitle("⚙️ " + guild.name + " — Setup Menu")
        .setDescription(
            "Use the buttons below to configure the bot.\n" +
            "Set channels, roles, and DM templates from here.\n\n" +
            "**Tickets:** Set both **Support Cat** and **HighRank Cat** to enable separate ticket categories."
        )
        .setColor(WEBHOOK_COLOR)
        .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
        .addFields(
            { name: "General", value: "**Prefix:** `" + gc.prefix + "`", inline: false },
            {
                name: "Channels",
                value: [
                    "**Logs:** " + ch(gc.logChannelId),
                    "**Welcome:** " + ch(gc.welcomeChannelId),
                    "**Suggestions:** " + ch(gc.suggestionChannelId),
                    "**Staff Feedback:** " + ch(gc.staffFeedbackChannelId),
                    "**Staff Logs:** " + ch(gc.staffLogChannelId),
                    "**HR Logs:** " + ch(gc.hrLogChannelId),
                    "**Verify:** " + ch(gc.verifyChannelId),
                    "**Ticket Log:** " + ch(gc.ticketLogChannelId),
                    "**Support Category:** " + ch(gc.ticketCategoryId),
                    "**HighRank Category:** " + ch(gc.ticketCategoryHighRankId)
                ].join("\n"),
                inline: false
            },
            {
                name: "Roles",
                value: [
                    "**Staff:** " + roleList(gc.staffRoles),
                    "**Admin:** " + roleList(gc.adminRoles),
                    "**Exempt:** " + roleList(gc.exemptRoles),
                    "**Verify Role:** " + (gc.verifyRoleId ? "<@&" + gc.verifyRoleId + ">" : "Not set"),
                    "**Accept Roles:** " + roleList(gc.acceptRoleIds)
                ].join("\n"),
                inline: false
            },
            { name: "Webhook", value: gc.webhookUrl ? "✅ Configured" : "❌ Not set", inline: true }
        )
        .setFooter({ text: "V.1.2.1 • " + guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();
}

function buildSetupRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_channels").setLabel("Channels").setEmoji("📁").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_roles").setLabel("Roles").setEmoji("🎭").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_prefix").setLabel("Prefix").setEmoji("🔤").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_webhook").setLabel("Webhook").setEmoji("🔗").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_dm_templates").setLabel("DM Templates").setEmoji("✉️").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_post_verify").setLabel("Post Verify").setEmoji("🛡️").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("setup_post_tickets").setLabel("Post Tickets").setEmoji("🎫").setStyle(ButtonStyle.Success)
        )
    ];
}

function buildChannelsMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ch_logs").setLabel("Logs").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_welcome").setLabel("Welcome").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_suggestions").setLabel("Suggestions").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_stafffb").setLabel("Staff FB").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_stafflogs").setLabel("Staff Logs").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_ch_hrlogs").setLabel("HR Logs").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_verify").setLabel("Verify Ch").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_ticketlog").setLabel("Ticket Log").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_ch_ticketcat").setLabel("Support Cat").setStyle(ButtonStyle.Primary),
            new ButtonBuilder().setCustomId("setup_ch_ticketcathr").setLabel("HighRank Cat").setStyle(ButtonStyle.Primary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setStyle(ButtonStyle.Danger)
        )
    ];
}

function buildRolesMenuRows() {
    return [
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_role_staff").setLabel("Staff Role").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_admin").setLabel("Admin Role").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_exempt").setLabel("Exempt Role").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_role_verify").setLabel("Verify Role").setStyle(ButtonStyle.Secondary)
        ),
        new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId("setup_role_accept").setLabel("Accept Roles").setStyle(ButtonStyle.Secondary),
            new ButtonBuilder().setCustomId("setup_clear_staff").setLabel("Clear Staff").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_clear_admin").setLabel("Clear Admin").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_clear_accept").setLabel("Clear Accept").setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setStyle(ButtonStyle.Danger)
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
            new ButtonBuilder().setCustomId("setup_back").setLabel("Back").setStyle(ButtonStyle.Danger)
        )
    ];
}

// ==========================================
// SETUP NAV
// ==========================================

async function updateSetupMessage(interaction, view) {
    const guild = interaction.guild;
    let embed, rows;
    if (view === "main") { embed = buildSetupEmbed(guild); rows = buildSetupRows(); }
    else if (view === "channels") {
        embed = new EmbedBuilder()
            .setTitle("📁 Channel Configuration")
            .setDescription("Click a button to set the corresponding channel. A channel select menu will appear.")
            .setColor(WEBHOOK_COLOR)
            .setThumbnail(guild.iconURL({ dynamic: true }))
            .setTimestamp();
        rows = buildChannelsMenuRows();
    } else if (view === "roles") {
        embed = new EmbedBuilder()
            .setTitle("🎭 Role Configuration")
            .setDescription("Click a button to add/change a role. Click a red button to clear the list.")
            .setColor(WEBHOOK_COLOR)
            .setThumbnail(guild.iconURL({ dynamic: true }))
            .setTimestamp();
        rows = buildRolesMenuRows();
    } else if (view === "templates") {
        const gc = getGuildConfig(guild.id);
        embed = new EmbedBuilder()
            .setTitle("✉️ DM Templates")
            .setDescription(
                "**Variables:** `{server}` `{rank}` `{type}` `{reason}` `{notes}`\n\n" +
                "**Accept:**\n" + gc.dmTemplates.accept + "\n\n" +
                "**Promote:**\n" + gc.dmTemplates.promote + "\n\n" +
                "**Demote:**\n" + gc.dmTemplates.demote + "\n\n" +
                "**Infract:**\n" + gc.dmTemplates.infract
            )
            .setColor(WEBHOOK_COLOR)
            .setTimestamp();
        rows = buildTemplatesMenuRows();
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
        if (interaction.isStringSelectMenu() || interaction.isChannelSelectMenu() || interaction.isRoleSelectMenu()) {
            return handleSelect(interaction);
        }

        if (!interaction.isChatInputCommand()) return;

        const guild = interaction.guild;
        if (!guild) return;
        const gc = getGuildConfig(guild.id);
        const command = interaction.commandName;

        // ---------- /setup ----------
        if (command === "setup") {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You need administrator permissions.")], ephemeral: true });
            }
            return interaction.reply({ embeds: [buildSetupEmbed(guild)], components: buildSetupRows(), ephemeral: true });
        }

        // ---------- /setprefix ----------
        if (command === "setprefix") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const prefix = interaction.options.getString("prefix");
            if (/\s/.test(prefix)) return interaction.reply({ embeds: [createErrorEmbed("No spaces.")], ephemeral: true });
            gc.prefix = prefix; saveConfig();
            return interaction.reply({ embeds: [createSuccessEmbed("Prefix set to `" + prefix + "`.")] });
        }

        // ---------- /setupverify ----------
        if (command === "setupverify") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            gc.verifyChannelId = interaction.channel.id;
            saveConfig();
            await interaction.channel.send({ embeds: [buildVerifyEmbed(guild)], components: buildVerifyRows() });
            return interaction.reply({ embeds: [createSuccessEmbed("Verification panel posted.")], ephemeral: true });
        }

        // ---------- /setuptickets ----------
        if (command === "setuptickets") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            await interaction.channel.send({ embeds: [buildTicketPanelEmbed(guild)], components: buildTicketPanelRows() });
            return interaction.reply({ embeds: [createSuccessEmbed("Ticket panel posted.")], ephemeral: true });
        }

        // ---------- WEBHOOK ----------
        if (command === "set-webhook") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const url = interaction.options.getString("url");
            if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(url)) {
                return interaction.reply({ embeds: [createErrorEmbed("Not a valid Discord webhook URL.")], ephemeral: true });
            }
            gc.webhookUrl = url; saveConfig();
            return interaction.reply({ embeds: [createSuccessEmbed("Webhook set.")], ephemeral: true });
        }
        if (command === "remove-webhook") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            gc.webhookUrl = null; saveConfig();
            return interaction.reply({ embeds: [createSuccessEmbed("Webhook removed.")], ephemeral: true });
        }

        // ---------- /acceptsetup ----------
        if (command === "acceptsetup") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const sub = interaction.options.getSubcommand();
            if (sub === "add") {
                const role = interaction.options.getRole("role");
                if (!gc.acceptRoleIds.includes(role.id)) gc.acceptRoleIds.push(role.id);
                saveConfig();
                return interaction.reply({ embeds: [createSuccessEmbed(role + " added to accept roles.")] });
            }
            if (sub === "remove") {
                const role = interaction.options.getRole("role");
                gc.acceptRoleIds = gc.acceptRoleIds.filter(id => id !== role.id);
                saveConfig();
                return interaction.reply({ embeds: [createSuccessEmbed(role + " removed from accept roles.")] });
            }
            if (sub === "list") {
                const list = gc.acceptRoleIds.length ? gc.acceptRoleIds.map(id => "<@&" + id + ">").join(", ") : "None";
                return interaction.reply({ embeds: [createInfoEmbed("**Accept Roles:** " + list)], ephemeral: true });
            }
            if (sub === "clear") {
                gc.acceptRoleIds = []; saveConfig();
                return interaction.reply({ embeds: [createSuccessEmbed("Accept roles cleared.")] });
            }
        }

        // ---------- /accept ----------
        if (command === "accept") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const notes = interaction.options.getString("notes") || null;
            await interaction.deferReply();

            let roleGiven = 0;
            if (gc.acceptRoleIds.length) {
                const member = await guild.members.fetch(targetUser.id).catch(() => null);
                if (member) {
                    for (const rid of gc.acceptRoleIds) {
                        try { await member.roles.add(rid, "Application accepted"); roleGiven++; }
                        catch (e) { console.error("add role:", e); }
                    }
                }
            }

            const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "accept", { notes: notes || "" }));

            const logEmbed = new EmbedBuilder()
                .setTitle("Application Accepted")
                .setColor(0x57F287)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "Accepted By", value: interaction.user.tag, inline: true },
                    { name: "Roles Given", value: roleGiven > 0 ? gc.acceptRoleIds.map(id => "<@&" + id + ">").join(", ") : "None", inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No", inline: true }
                )
                .setTimestamp();
            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024) });

            await sendHRLog(guild, logEmbed);
            await sendLog(guild, logEmbed);
            await sendWebhook(guild, logEmbed);

            return interaction.editReply({ embeds: [createSuccessEmbed("**" + targetUser.tag + "** accepted. DM: " + dmSent + ". Roles: " + roleGiven + ".")] });
        }

        // ---------- /promote ----------
        if (command === "promote") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const rank = interaction.options.getString("rank");
            const notes = interaction.options.getString("notes") || null;
            await interaction.deferReply();

            const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "promote", { rank, notes: notes || "" }));

            const logEmbed = new EmbedBuilder()
                .setTitle("Promotion")
                .setColor(0x57F287)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "New Rank", value: rank, inline: true },
                    { name: "Promoted By", value: interaction.user.tag, inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No", inline: true }
                )
                .setTimestamp();
            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024) });

            await sendHRLog(guild, logEmbed);
            await sendLog(guild, logEmbed);
            await sendWebhook(guild, logEmbed);

            return interaction.editReply({ embeds: [createSuccessEmbed("**" + targetUser.tag + "** promoted to **" + rank + "**. DM: " + dmSent + ".")] });
        }

        // ---------- /demote ----------
        if (command === "demote") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const rank = interaction.options.getString("rank");
            const notes = interaction.options.getString("notes") || null;
            await interaction.deferReply();

            const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "demote", { rank, notes: notes || "" }));

            const logEmbed = new EmbedBuilder()
                .setTitle("Demotion")
                .setColor(0xED4245)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "New Rank", value: rank, inline: true },
                    { name: "Demoted By", value: interaction.user.tag, inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No", inline: true }
                )
                .setTimestamp();
            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024) });

            await sendHRLog(guild, logEmbed);
            await sendLog(guild, logEmbed);
            await sendWebhook(guild, logEmbed);

            return interaction.editReply({ embeds: [createSuccessEmbed("**" + targetUser.tag + "** demoted to **" + rank + "**. DM: " + dmSent + ".")] });
        }

        // ---------- /infract ----------
        if (command === "infract") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const type = interaction.options.getString("type");
            const reason = interaction.options.getString("reason");
            const notes = interaction.options.getString("notes") || null;
            await interaction.deferReply();

            const dmSent = await tryDM(targetUser, buildTemplateDM(guild, "infract", { type, reason, notes: notes || "" }));

            const colors = { warn: 0xFEE75C, strike: 0xED4245, demotion: 0xED4245, suspension: 0x992D22 };
            const logEmbed = new EmbedBuilder()
                .setTitle("Infraction Issued")
                .setColor(colors[type] || 0xED4245)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "Type", value: type.charAt(0).toUpperCase() + type.slice(1), inline: true },
                    { name: "Moderator", value: interaction.user.tag, inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No", inline: true },
                    { name: "Reason", value: reason, inline: false }
                )
                .setTimestamp();
            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024) });

            await sendHRLog(guild, logEmbed);
            await sendLog(guild, logEmbed);
            await sendWebhook(guild, logEmbed);

            return interaction.editReply({ embeds: [createSuccessEmbed("**" + targetUser.tag + "** infracted: **" + type + "**. DM: " + dmSent + ".")] });
        }

        // ---------- /suggest ----------
        if (command === "suggest") {
            if (!gc.suggestionChannelId) return interaction.reply({ embeds: [createErrorEmbed("Suggestions channel not set.")], ephemeral: true });
            const suggestion = interaction.options.getString("suggestion");
            const suggestionChannel = guild.channels.cache.get(gc.suggestionChannelId);
            if (!suggestionChannel) return interaction.reply({ embeds: [createErrorEmbed("Channel not found.")], ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            const initialEmbed = buildSuggestionEmbed(suggestion, interaction.user, 0, 0);
            const sentMessage = await suggestionChannel.send({ embeds: [initialEmbed], components: [buildVoteRow("pending", "suggestion")] });
            const finalEmbed = buildSuggestionEmbed(suggestion, interaction.user, 0, 0);
            const finalRow = buildVoteRow(sentMessage.id, "suggestion");
            await sentMessage.edit({ embeds: [finalEmbed], components: [finalRow] });

            gc.suggestions[sentMessage.id] = { authorId: interaction.user.id, content: suggestion, upvotes: [], downvotes: [], createdAt: Date.now() };
            saveConfig();
            return interaction.editReply({ embeds: [createSuccessEmbed("Suggestion submitted!")] });
        }

        // ---------- /staff-feedback ----------
        if (command === "staff-feedback") {
            if (!gc.staffFeedbackChannelId) return interaction.reply({ embeds: [createErrorEmbed("Staff feedback channel not set.")], ephemeral: true });
            const staffMember = interaction.options.getUser("staff");
            const feedback = interaction.options.getString("feedback");
            const channel = guild.channels.cache.get(gc.staffFeedbackChannelId);
            if (!channel) return interaction.reply({ embeds: [createErrorEmbed("Channel not found.")], ephemeral: true });

            await interaction.deferReply({ ephemeral: true });
            const initialEmbed = buildStaffFeedbackEmbed(staffMember, feedback, interaction.user, 0, 0);
            const sentMessage = await channel.send({ embeds: [initialEmbed], components: [buildVoteRow("pending", "feedback")] });
            const finalEmbed = buildStaffFeedbackEmbed(staffMember, feedback, interaction.user, 0, 0);
            const finalRow = buildVoteRow(sentMessage.id, "feedback");
            await sentMessage.edit({ embeds: [finalEmbed], components: [finalRow] });

            gc.staffFeedback[sentMessage.id] = { authorId: interaction.user.id, staffId: staffMember.id, content: feedback, upvotes: [], downvotes: [], createdAt: Date.now() };
            saveConfig();
            return interaction.editReply({ embeds: [createSuccessEmbed("Feedback submitted!")] });
        }

        // ---------- /mute ----------
        if (command === "mute") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const target = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [createErrorEmbed("Member not found.")], ephemeral: true });
            if (isExempt(target)) return interaction.reply({ embeds: [createErrorEmbed("Target is exempt.")], ephemeral: true });
            if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [createErrorEmbed("Role hierarchy blocks this.")], ephemeral: true });

            const durationInput = interaction.options.getString("duration");
            const duration = parseDuration(durationInput);
            if (!duration) return interaction.reply({ embeds: [createErrorEmbed("Invalid duration. Ex: 10m, 1h, 1d.")], ephemeral: true });

            const limit = getLimitData(guild.id, interaction.user.id);
            if (limit.mutes >= DAILY_LIMIT) return interaction.reply({ embeds: [createErrorEmbed("Daily mute limit reached.")], ephemeral: true });

            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                await target.timeout(duration, reason);
                limit.mutes++; saveConfig();
                const embed = createLogEmbed("Member Muted",
                    "**User:** " + target + "\n**Moderator:** " + interaction.user + "\n**Duration:** " + durationInput + "\n**Reason:** " + reason + "\n**Daily Mutes:** " + limit.mutes + "/" + DAILY_LIMIT);
                await sendLog(guild, embed);
                await sendWebhook(guild, embed);
                return interaction.reply({ embeds: [createSuccessEmbed(target + " muted for **" + durationInput + "**.")] });
            } catch (e) {
                console.error(e);
                return interaction.reply({ embeds: [createErrorEmbed("Could not mute.")], ephemeral: true });
            }
        }

        // ---------- /unmute ----------
        if (command === "unmute") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const target = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [createErrorEmbed("Member not found.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                await target.timeout(null, reason);
                const embed = createLogEmbed("Member Unmuted", "**User:** " + target + "\n**Moderator:** " + interaction.user + "\n**Reason:** " + reason);
                await sendLog(guild, embed);
                await sendWebhook(guild, embed);
                return interaction.reply({ embeds: [createSuccessEmbed(target + " unmuted.")] });
            } catch (e) {
                console.error(e);
                return interaction.reply({ embeds: [createErrorEmbed("Could not unmute.")], ephemeral: true });
            }
        }

        // ---------- /kick ----------
        if (command === "kick") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const target = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [createErrorEmbed("Member not found.")], ephemeral: true });
            if (isExempt(target)) return interaction.reply({ embeds: [createErrorEmbed("Target is exempt.")], ephemeral: true });
            if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [createErrorEmbed("Role hierarchy blocks this.")], ephemeral: true });

            const limit = getLimitData(guild.id, interaction.user.id);
            if (limit.kicks >= DAILY_LIMIT) return interaction.reply({ embeds: [createErrorEmbed("Daily kick limit reached.")], ephemeral: true });

            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                await target.kick(reason);
                limit.kicks++; saveConfig();
                const embed = createLogEmbed("Member Kicked",
                    "**User:** " + target.user.tag + "\n**Moderator:** " + interaction.user + "\n**Reason:** " + reason + "\n**Daily Kicks:** " + limit.kicks + "/" + DAILY_LIMIT);
                await sendLog(guild, embed);
                await sendWebhook(guild, embed);
                return interaction.reply({ embeds: [createSuccessEmbed(target.user.tag + " kicked.")] });
            } catch (e) {
                console.error(e);
                return interaction.reply({ embeds: [createErrorEmbed("Could not kick.")], ephemeral: true });
            }
        }

        // ---------- /ban ----------
        if (command === "ban") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const targetUser = interaction.options.getUser("user");
            const target = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [createErrorEmbed("Member not found.")], ephemeral: true });
            if (isExempt(target)) return interaction.reply({ embeds: [createErrorEmbed("Target is exempt.")], ephemeral: true });
            if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [createErrorEmbed("Role hierarchy blocks this.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                await target.ban({ reason });
                const embed = createLogEmbed("Member Banned", "**User:** " + target.user.tag + "\n**Moderator:** " + interaction.user + "\n**Reason:** " + reason);
                await sendLog(guild, embed);
                await sendWebhook(guild, embed);
                return interaction.reply({ embeds: [createSuccessEmbed(target.user.tag + " banned.")] });
            } catch (e) {
                console.error(e);
                return interaction.reply({ embeds: [createErrorEmbed("Could not ban.")], ephemeral: true });
            }
        }

        // ---------- /unban ----------
        if (command === "unban") {
            if (!isAdmin(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Admin only.")], ephemeral: true });
            const userId = interaction.options.getString("userid");
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                const user = await client.users.fetch(userId);
                await guild.members.unban(userId, reason);
                const embed = createLogEmbed("Member Unbanned", "**User:** " + user.tag + "\n**Moderator:** " + interaction.user + "\n**Reason:** " + reason);
                await sendLog(guild, embed);
                await sendWebhook(guild, embed);
                return interaction.reply({ embeds: [createSuccessEmbed(user.tag + " unbanned.")] });
            } catch (e) {
                console.error(e);
                return interaction.reply({ embeds: [createErrorEmbed("Could not unban.")], ephemeral: true });
            }
        }

        // ---------- /loguser ----------
        if (command === "loguser") {
            if (!isStaff(interaction.member)) return interaction.reply({ embeds: [createErrorEmbed("Staff only.")], ephemeral: true });
            const username = interaction.options.getString("username");
            const punishment = interaction.options.getString("punishment");
            const reason = interaction.options.getString("reason");
            await interaction.deferReply();
            const robloxData = await lookupRobloxUser(username);

            const logEmbed = new EmbedBuilder()
                .setTitle("Punishment Log")
                .setColor(0xED4245)
                .addFields(
                    { name: "Roblox Username", value: robloxData ? robloxData.username : username, inline: true },
                    { name: "Roblox ID", value: robloxData ? String(robloxData.id) : "Not found", inline: true },
                    { name: "Display Name", value: robloxData ? robloxData.displayName : "N/A", inline: true },
                    { name: "Punishment", value: punishment, inline: true },
                    { name: "Moderator", value: interaction.user.tag, inline: true },
                    { name: "Logged At", value: "<t:" + Math.floor(Date.now() / 1000) + ":F>", inline: true },
                    { name: "Reason", value: reason, inline: false }
                )
                .setFooter({ text: "Logged by " + interaction.user.tag })
                .setTimestamp();

            if (robloxData) {
                if (robloxData.avatarUrl) logEmbed.setThumbnail(robloxData.avatarUrl);
                logEmbed.addFields(
                    { name: "Account Created", value: "<t:" + Math.floor(new Date(robloxData.created).getTime() / 1000) + ":F>", inline: false },
                    { name: "Profile", value: "[View Profile](" + robloxData.profileUrl + ")", inline: false }
                );
            } else {
                logEmbed.addFields({ name: "Roblox Lookup", value: "❌ User not found", inline: false });
            }

            await sendStaffLog(guild, logEmbed);
            await sendLog(guild, logEmbed);
            await sendWebhook(guild, logEmbed);
            return interaction.editReply({ embeds: [createSuccessEmbed("Punishment log recorded for **" + username + "**.")] });
        }

        // ---------- /help ----------
        if (command === "help") {
            const prefix = getPrefix(guild.id);
            const embed = new EmbedBuilder()
                .setTitle(guild.name + " — Bot Commands V.1.2.1")
                .setColor(WEBHOOK_COLOR)
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: "General", value: ["`/help`", "`/setup`", "`/setprefix <prefix>`"].join("\n") },
                    { name: "Verification & Tickets", value: ["`/setupverify`", "`/setuptickets`", "`/set-webhook <url>`", "`/remove-webhook`"].join("\n") },
                    { name: "HR / Applications", value: [
                        "`/acceptsetup add|remove|list|clear`",
                        "`/accept <user> [notes]`",
                        "`/promote <user> <rank> [notes]`",
                        "`/demote <user> <rank> [notes]`",
                        "`/infract <user> <type> <reason> [notes]`"
                    ].join("\n") },
                    { name: "Suggestions & Feedback", value: ["`/suggest <suggestion>`", "`/staff-feedback <staff> <feedback>`"].join("\n") },
                    { name: "Moderation", value: [
                        "`/mute <user> <duration> [reason]`",
                        "`/unmute <user> [reason]`",
                        "`/kick <user> [reason]`",
                        "`/ban <user> [reason]`",
                        "`/unban <userid> [reason]`"
                    ].join("\n") },
                    { name: "Logging", value: ["`/loguser <username> <punishment> <reason>`", "`" + prefix + "loguser <username> <punishment> <reason>`"].join("\n") }
                );
            return interaction.reply({ embeds: [embed] });
        }

    } catch (error) {
        console.error("Interaction error:", error);
        try {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ embeds: [createErrorEmbed("An error occurred.")], ephemeral: true });
            } else {
                await interaction.reply({ embeds: [createErrorEmbed("An error occurred.")], ephemeral: true });
            }
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

    // ---- SETUP NAV ----
    if (id === "setup_back") return updateSetupMessage(interaction, "main");
    if (id === "setup_channels") return updateSetupMessage(interaction, "channels");
    if (id === "setup_roles") return updateSetupMessage(interaction, "roles");
    if (id === "setup_dm_templates") return updateSetupMessage(interaction, "templates");

    if (id === "setup_prefix") {
        const modal = new ModalBuilder().setCustomId("modal_prefix").setTitle("Set Prefix");
        const input = new TextInputBuilder().setCustomId("prefix").setLabel("New prefix (max 5 chars)").setStyle(TextInputStyle.Short).setMaxLength(5).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    if (id === "setup_webhook") {
        const modal = new ModalBuilder().setCustomId("modal_webhook").setTitle("Set Webhook URL");
        const input = new TextInputBuilder().setCustomId("url").setLabel("Discord webhook URL").setStyle(TextInputStyle.Short).setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    // ---- SETUP: CHANNELS ----
    const channelMap = {
        setup_ch_logs: { key: "logChannelId", name: "Logging" },
        setup_ch_welcome: { key: "welcomeChannelId", name: "Welcome" },
        setup_ch_suggestions: { key: "suggestionChannelId", name: "Suggestions" },
        setup_ch_stafffb: { key: "staffFeedbackChannelId", name: "Staff Feedback" },
        setup_ch_stafflogs: { key: "staffLogChannelId", name: "Staff Logs" },
        setup_ch_hrlogs: { key: "hrLogChannelId", name: "HR Logs" },
        setup_ch_verify: { key: "verifyChannelId", name: "Verify" },
        setup_ch_ticketlog: { key: "ticketLogChannelId", name: "Ticket Log" },
        setup_ch_ticketcat: { key: "ticketCategoryId", name: "General Support Category", isCategory: true },
        setup_ch_ticketcathr: { key: "ticketCategoryHighRankId", name: "High Rank Category", isCategory: true }
    };
    if (channelMap[id]) {
        const cfg = channelMap[id];
        const select = new ChannelSelectMenuBuilder()
            .setCustomId("select_channel_" + cfg.key)
            .setPlaceholder("Pick a channel for " + cfg.name)
            .setChannelTypes(cfg.isCategory ? [ChannelType.GuildCategory] : [ChannelType.GuildText, ChannelType.GuildAnnouncement]);
        return interaction.update({
            embeds: [createInfoEmbed("Choose a channel for **" + cfg.name + "**:")],
            components: [new ActionRowBuilder().addComponents(select)]
        });
    }

    // ---- SETUP: ROLES ----
    const roleMap = {
        setup_role_staff: { key: "staffRoles", name: "Staff" },
        setup_role_admin: { key: "adminRoles", name: "Admin" },
        setup_role_exempt: { key: "exemptRoles", name: "Exempt" },
        setup_role_verify: { key: "verifyRoleId", name: "Verify", single: true },
        setup_role_accept: { key: "acceptRoleIds", name: "Accept" }
    };
    if (roleMap[id]) {
        const cfg = roleMap[id];
        const select = new RoleSelectMenuBuilder()
            .setCustomId("select_role_" + cfg.key)
            .setPlaceholder("Pick a role for " + cfg.name)
            .setMaxValues(cfg.single ? 1 : 10);
        return interaction.update({
            embeds: [createInfoEmbed("Choose a role for **" + cfg.name + "**:")],
            components: [new ActionRowBuilder().addComponents(select)]
        });
    }

    // ---- SETUP: CLEAR ----
    if (id === "setup_clear_staff") { gc.staffRoles = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_admin") { gc.adminRoles = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }
    if (id === "setup_clear_accept") { gc.acceptRoleIds = []; saveConfig(); return updateSetupMessage(interaction, "roles"); }

    // ---- SETUP: POST PANELS ----
    if (id === "setup_post_verify") {
        await interaction.channel.send({ embeds: [buildVerifyEmbed(guild)], components: buildVerifyRows() });
        return interaction.reply({ embeds: [createSuccessEmbed("Verification panel posted.")], ephemeral: true });
    }
    if (id === "setup_post_tickets") {
        await interaction.channel.send({ embeds: [buildTicketPanelEmbed(guild)], components: buildTicketPanelRows() });
        return interaction.reply({ embeds: [createSuccessEmbed("Ticket panel posted.")], ephemeral: true });
    }

    // ---- SETUP: DM TEMPLATES ----
    const tplMap = {
        setup_tpl_accept: { key: "accept", name: "Accept DM" },
        setup_tpl_promote: { key: "promote", name: "Promote DM" },
        setup_tpl_demote: { key: "demote", name: "Demote DM" },
        setup_tpl_infract: { key: "infract", name: "Infract DM" }
    };
    if (tplMap[id]) {
        const cfg = tplMap[id];
        const modal = new ModalBuilder().setCustomId("modal_tpl_" + cfg.key).setTitle("Edit " + cfg.name);
        const input = new TextInputBuilder()
            .setCustomId("template")
            .setLabel("Template (vars: {server} {rank} {type} {reason} {notes})")
            .setStyle(TextInputStyle.Paragraph)
            .setValue(gc.dmTemplates[cfg.key])
            .setRequired(true);
        modal.addComponents(new ActionRowBuilder().addComponents(input));
        return interaction.showModal(modal);
    }

    // ---- VOTES ----
    if (id.startsWith("vote_")) return handleVoteButton(interaction);

    // ---- VERIFY ----
    if (id === "verify_start") return handleVerifyStart(interaction);
    if (id === "verify_check") return handleVerifyCheck(interaction);
    if (id === "verify_help") {
        // Auto-open a General Support ticket
        return handleTicketCreate(
            interaction,
            "support",
            "User clicked **I Can't Verify** on the verification panel."
        );
    }

    // ---- TICKETS ----
    if (id === "ticket_open_menu") {
        return interaction.reply({
            embeds: [createInfoEmbed("**Which support do you need?**")],
            components: buildTicketTypeRows(),
            ephemeral: true
        });
    }
    if (id === "ticket_rules") {
        return interaction.reply({ embeds: [buildTicketRulesEmbed(guild)], ephemeral: true });
    }
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
        const key = id.slice("select_channel_".length);
        gc[key] = interaction.values[0];
        saveConfig();
        return updateSetupMessage(interaction, "channels");
    }

    if (id.startsWith("select_role_")) {
        const key = id.slice("select_role_".length);
        const values = interaction.values;

        if (key === "verifyRoleId") {
            gc.verifyRoleId = values[0];
        } else {
            for (const rid of values) {
                if (!gc[key].includes(rid)) gc[key].push(rid);
            }
        }
        saveConfig();
        return updateSetupMessage(interaction, "roles");
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
        if (/\s/.test(prefix)) {
            return interaction.reply({ embeds: [createErrorEmbed("No spaces allowed.")], ephemeral: true });
        }
        gc.prefix = prefix; saveConfig();
        return interaction.reply({ embeds: [createSuccessEmbed("Prefix set to `" + prefix + "`.")], ephemeral: true });
    }

    if (id === "modal_webhook") {
        const url = interaction.fields.getTextInputValue("url");
        if (!/^https:\/\/discord(app)?\.com\/api\/webhooks\//.test(url)) {
            return interaction.reply({ embeds: [createErrorEmbed("Invalid webhook URL.")], ephemeral: true });
        }
        gc.webhookUrl = url; saveConfig();
        return interaction.reply({ embeds: [createSuccessEmbed("Webhook saved.")], ephemeral: true });
    }

    if (id.startsWith("modal_tpl_")) {
        const key = id.slice("modal_tpl_".length);
        gc.dmTemplates[key] = interaction.fields.getTextInputValue("template");
        saveConfig();
        return interaction.reply({ embeds: [createSuccessEmbed("Template **" + key + "** updated.")], ephemeral: true });
    }

    if (id === "modal_verify_username") {
        const username = interaction.fields.getTextInputValue("username").trim();
        const robloxData = await lookupRobloxUser(username);
        if (!robloxData) {
            return interaction.reply({ embeds: [createErrorEmbed("Could not find that Roblox username.")], ephemeral: true });
        }

        const code = generateCode();
        gc.verifySessions[interaction.user.id] = {
            code,
            robloxId: robloxData.id,
            robloxUsername: robloxData.username,
            createdAt: Date.now()
        };
        saveConfig();

        const embed = new EmbedBuilder()
            .setTitle("Verification Code")
            .setDescription(
                "**Step 1:** Open your Roblox profile: [Click here](" + robloxData.profileUrl + ")\n" +
                "**Step 2:** Paste the code below into your **About** section and save.\n" +
                "**Step 3:** Return here and click **Check Verification**.\n\n" +
                "**Your code:**\n`" + code + "`\n\n" +
                "_You can remove the code from your profile once verified._"
            )
            .setColor(WEBHOOK_COLOR)
            .setThumbnail(robloxData.avatarUrl || guild.iconURL({ dynamic: true }))
            .setTimestamp();

        return interaction.reply({ embeds: [embed], ephemeral: true });
    }
}

// ==========================================
// VERIFY FLOW
// ==========================================

async function handleVerifyStart(interaction) {
    const modal = new ModalBuilder().setCustomId("modal_verify_username").setTitle("Roblox Verification");
    const input = new TextInputBuilder()
        .setCustomId("username")
        .setLabel("Your Roblox username")
        .setStyle(TextInputStyle.Short)
        .setRequired(true);
    modal.addComponents(new ActionRowBuilder().addComponents(input));
    return interaction.showModal(modal);
}

async function handleVerifyCheck(interaction) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    const session = gc.verifySessions[interaction.user.id];

    if (!session) {
        return interaction.reply({ embeds: [createErrorEmbed("No active verification session. Click **Verify** first.")], ephemeral: true });
    }

    await interaction.deferReply({ ephemeral: true });

    const robloxData = await lookupRobloxUser(session.robloxUsername);
    if (!robloxData) {
        return interaction.editReply({ embeds: [createErrorEmbed("Could not fetch your Roblox profile.")] });
    }

    if (!robloxData.description.includes(session.code)) {
        return interaction.editReply({ embeds: [createErrorEmbed("Code not found in your Roblox About section. Save it and try again.")] });
    }

    gc.verifiedUsers[interaction.user.id] = {
        robloxId: robloxData.id,
        robloxUsername: robloxData.username,
        verifiedAt: Date.now()
    };
    delete gc.verifySessions[interaction.user.id];
    saveConfig();

    let roleGiven = false;
    if (gc.verifyRoleId) {
        try {
            await interaction.member.roles.add(gc.verifyRoleId, "Verified via Roblox");
            roleGiven = true;
        } catch (e) { console.error("verify role:", e); }
    }

    const successEmbed = new EmbedBuilder()
        .setTitle("✅ Verification Successful")
        .setDescription("Welcome, **" + robloxData.username + "**! You have been verified on **" + guild.name + "**.")
        .setColor(0x57F287)
        .setThumbnail(robloxData.avatarUrl || null)
        .setTimestamp();

    const logEmbed = new EmbedBuilder()
        .setTitle("User Verified")
        .setColor(WEBHOOK_COLOR)
        .addFields(
            { name: "Discord", value: interaction.user.tag + " (" + interaction.user.id + ")", inline: true },
            { name: "Roblox", value: robloxData.username + " (" + robloxData.id + ")", inline: true },
            { name: "Role Given", value: roleGiven ? "Yes" : "No", inline: true }
        )
        .setThumbnail(robloxData.avatarUrl || null)
        .setTimestamp();

    await sendLog(guild, logEmbed);
    await sendWebhook(guild, logEmbed);

    return interaction.editReply({ embeds: [successEmbed] });
}

// ==========================================
// TICKETS
// ==========================================

const TICKET_TYPES = {
    support: {
        label: "General Support",
        slug: "general-support",
        emoji: "⚙️",
        categoryKey: "ticketCategoryId",
        pingRolesKey: "staffRoles"
    },
    highrank: {
        label: "High Rank",
        slug: "high-rank",
        emoji: "🛡️",
        categoryKey: "ticketCategoryHighRankId",
        pingRolesKey: "adminRoles"
    }
};

async function handleTicketCreate(interaction, type, prefillReason) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    const cfg = TICKET_TYPES[type];

    if (!cfg) {
        return interaction.reply({ embeds: [createErrorEmbed("Unknown ticket type.")], ephemeral: true });
    }

    // ---- Already open? ----
    const existing = Object.entries(gc.tickets).find(
        ([, t]) => t.userId === interaction.user.id && t.open
    );
    if (existing) {
        const existingChannel = guild.channels.cache.get(existing[0]);
        const msg = existingChannel
            ? "You already have an open ticket: " + existingChannel
            : "You already have an open ticket. If the channel was deleted, ask an admin to clean up `config.json`.";
        return interaction.reply({ embeds: [createErrorEmbed(msg)], ephemeral: true });
    }

    // ---- Category check ----
    const categoryId = gc[cfg.categoryKey];
    if (!categoryId) {
        return interaction.reply({
            embeds: [createErrorEmbed("The **" + cfg.label + "** category is not set. Ask an admin to configure it in `/setup → Channels`.")],
            ephemeral: true
        });
    }
    const category = guild.channels.cache.get(categoryId);
    if (!category || category.type !== ChannelType.GuildCategory) {
        return interaction.reply({
            embeds: [createErrorEmbed("The configured category no longer exists. Ask an admin to re-set it.")],
            ephemeral: true
        });
    }

    if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
    }

    // ---- Ticket number ----
    const ticketNumber = (gc.ticketCounter || 0) + 1;
    gc.ticketCounter = ticketNumber;

    // ---- Channel name: <number>-<slug>-<username> ----
    const cleanUser = interaction.user.username
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 15) || "user";

    const channelName = ticketNumber + "-" + cfg.slug + "-" + cleanUser;

    // ---- Permissions ----
    const permissionOverwrites = [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
            id: interaction.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.AttachFiles,
                PermissionFlagsBits.EmbedLinks
            ]
        },
        {
            id: client.user.id,
            allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.ReadMessageHistory
            ]
        }
    ];

    const pingRoleIds = gc[cfg.pingRolesKey] || [];
    for (const rid of [...pingRoleIds, ...gc.adminRoles, ...gc.staffRoles]) {
        if (!permissionOverwrites.find(p => p.id === rid)) {
            permissionOverwrites.push({
                id: rid,
                allow: [
                    PermissionFlagsBits.ViewChannel,
                    PermissionFlagsBits.SendMessages,
                    PermissionFlagsBits.ReadMessageHistory
                ]
            });
        }
    }

    // ---- Create ----
    let channel;
    try {
        channel = await guild.channels.create({
            name: channelName,
            type: ChannelType.GuildText,
            parent: categoryId,
            permissionOverwrites,
            topic: "Ticket #" + ticketNumber + " • " + cfg.label + " • " + interaction.user.tag
        });
    } catch (e) {
        console.error("ticket create:", e);
        return interaction.editReply({ embeds: [createErrorEmbed("Could not create ticket. Check my permissions.")] });
    }

    gc.tickets[channel.id] = {
        userId: interaction.user.id,
        type,
        number: ticketNumber,
        name: cfg.slug,
        open: true,
        createdAt: Date.now()
    };
    saveConfig();

    // ---- Welcome embed ----
    const welcomeEmbed = new EmbedBuilder()
        .setTitle(cfg.emoji + " " + cfg.label + " — Ticket #" + ticketNumber)
        .setDescription(
            "**" + interaction.user + "**, thank you for opening a ticket.\n\n" +
            (prefillReason ? "**Reason:** " + prefillReason + "\n\n" : "") +
            "A staff member will assist you shortly. Please describe your issue in detail below."
        )
        .setColor(WEBHOOK_COLOR)
        .setThumbnail(guild.iconURL({ dynamic: true, size: 256 }))
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) || undefined })
        .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("ticket_close").setLabel("Close Ticket").setEmoji("🔒").setStyle(ButtonStyle.Danger)
    );

    const pingStr = pingRoleIds.map(id => "<@&" + id + ">").join(" ");
    await channel.send({
        content: interaction.user + (pingStr ? " " + pingStr : ""),
        embeds: [welcomeEmbed],
        components: [closeRow]
    }).catch(e => console.error("welcome msg:", e));

    // ---- Log ----
    const logEmbed = new EmbedBuilder()
        .setTitle("Ticket Opened")
        .setColor(WEBHOOK_COLOR)
        .addFields(
            { name: "Ticket #", value: String(ticketNumber), inline: true },
            { name: "Type", value: cfg.label, inline: true },
            { name: "User", value: interaction.user.tag + " (" + interaction.user.id + ")", inline: true },
            { name: "Channel", value: channel.toString(), inline: false }
        )
        .setTimestamp();

    if (gc.ticketLogChannelId) {
        const lc = guild.channels.cache.get(gc.ticketLogChannelId);
        if (lc) await lc.send({ embeds: [logEmbed] }).catch(() => {});
    }
    await sendWebhook(guild, logEmbed);

    return interaction.editReply({
        embeds: [createSuccessEmbed("Your **" + cfg.label + "** ticket has been created: " + channel)]
    });
}

async function handleTicketClose(interaction) {
    const guild = interaction.guild;
    const gc = getGuildConfig(guild.id);
    const ticket = gc.tickets[interaction.channel.id];

    if (!ticket) {
        return interaction.reply({ embeds: [createErrorEmbed("This channel is not a ticket.")], ephemeral: true });
    }

    const isOwner = interaction.user.id === ticket.userId;
    if (!isOwner && !isStaff(interaction.member)) {
        return interaction.reply({ embeds: [createErrorEmbed("Only the ticket owner or staff can close.")], ephemeral: true });
    }

    await interaction.reply({ embeds: [createInfoEmbed("🔒 Closing ticket in 5 seconds...")] });

    ticket.open = false;
    ticket.closedAt = Date.now();
    ticket.closedBy = interaction.user.id;
    saveConfig();

    const logEmbed = new EmbedBuilder()
        .setTitle("Ticket Closed")
        .setColor(0xED4245)
        .addFields(
            { name: "Ticket #", value: String(ticket.number), inline: true },
            { name: "Type", value: ticket.type, inline: true },
            { name: "Closed By", value: interaction.user.tag, inline: true }
        )
        .setTimestamp();

    if (gc.ticketLogChannelId) {
        const lc = guild.channels.cache.get(gc.ticketLogChannelId);
        if (lc) await lc.send({ embeds: [logEmbed] }).catch(() => {});
    }
    await sendWebhook(guild, logEmbed);

    setTimeout(async () => {
        try { await interaction.channel.delete("Ticket closed"); }
        catch (e) { console.error("delete ticket:", e); }
    }, 5000);
}

// ==========================================
// VOTES
// ==========================================

async function handleVoteButton(interaction) {
    try {
        const parts = interaction.customId.split("_");
        if (parts.length < 4) return interaction.reply({ embeds: [createErrorEmbed("Invalid vote.")], ephemeral: true });

        const direction = parts[1];
        const type = parts[2];
        const messageId = parts[3];

        const gc = getGuildConfig(interaction.guild.id);
        const store = type === "suggestion" ? gc.suggestions : gc.staffFeedback;

        if (!store[messageId]) {
            return interaction.reply({ embeds: [createErrorEmbed("Vote no longer valid.")], ephemeral: true });
        }

        const data = store[messageId];
        const userId = interaction.user.id;

        data.upvotes = data.upvotes.filter(id => id !== userId);
        data.downvotes = data.downvotes.filter(id => id !== userId);

        if (direction === "up") data.upvotes.push(userId);
        else data.downvotes.push(userId);

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
        return interaction.reply({ embeds: [createSuccessEmbed("You voted **" + (direction === "up" ? "up" : "down") + "**.")], ephemeral: true });
    } catch (error) {
        console.error("Vote error:", error);
        try { if (!interaction.replied) await interaction.reply({ embeds: [createErrorEmbed("Failed.")], ephemeral: true }); }
        catch (e) { /* ignore */ }
    }
}

function buildSuggestionEmbed(suggestion, author, upvotes, downvotes) {
    return new EmbedBuilder()
        .setTitle("New Suggestion")
        .setDescription(suggestion)
        .setColor(0x5865F2)
        .addFields(
            { name: "Author", value: String(author), inline: true },
            { name: "Status", value: "Pending Review", inline: true },
            { name: "Votes", value: "👍 " + upvotes + " | 👎 " + downvotes, inline: true }
        )
        .setFooter({ text: "User ID: " + author.id })
        .setTimestamp();
}

function buildStaffFeedbackEmbed(staffMember, feedback, author, upvotes, downvotes) {
    return new EmbedBuilder()
        .setTitle("Staff Feedback")
        .setDescription(feedback)
        .setColor(0xFEE75C)
        .addFields(
            { name: "Staff Member", value: String(staffMember), inline: true },
            { name: "Submitted By", value: String(author), inline: true },
            { name: "Votes", value: "👍 " + upvotes + " | 👎 " + downvotes, inline: true }
        )
        .setFooter({ text: "User ID: " + author.id })
        .setTimestamp();
}

function buildVoteRow(id, type) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("vote_up_" + type + "_" + id).setLabel("Upvote").setEmoji("👍").setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId("vote_down_" + type + "_" + id).setLabel("Downvote").setEmoji("👎").setStyle(ButtonStyle.Danger)
    );
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
    const gc = getGuildConfig(guild.id);

    try {
        if (command === "help") {
            const embed = new EmbedBuilder()
                .setTitle(guild.name + " — Prefix Commands")
                .setColor(WEBHOOK_COLOR)
                .addFields({
                    name: "Prefix Commands",
                    value: [
                        "`" + prefix + "help`",
                        "`" + prefix + "loguser <username> <punishment> <reason>`"
                    ].join("\n")
                });
            return message.reply({ embeds: [embed] });
        }

        if (command === "loguser") {
            if (!isStaff(message.member)) {
                return message.reply({ embeds: [createErrorEmbed("Staff only.")] });
            }
            const username = args[0];
            const punishment = args[1];
            const reason = args.slice(2).join(" ");

            if (!username || !punishment || !reason) {
                return message.reply({ embeds: [createErrorEmbed("Usage: `" + prefix + "loguser <username> <punishment> <reason>`")] });
            }

            await message.channel.sendTyping();
            const robloxData = await lookupRobloxUser(username);

            const logEmbed = new EmbedBuilder()
                .setTitle("Punishment Log")
                .setColor(0xED4245)
                .addFields(
                    { name: "Roblox Username", value: robloxData ? robloxData.username : username, inline: true },
                    { name: "Roblox ID", value: robloxData ? String(robloxData.id) : "Not found", inline: true },
                    { name: "Display Name", value: robloxData ? robloxData.displayName : "N/A", inline: true },
                    { name: "Punishment", value: punishment, inline: true },
                    { name: "Moderator", value: message.author.tag, inline: true },
                    { name: "Reason", value: reason, inline: false }
                )
                .setTimestamp();

            if (robloxData) {
                if (robloxData.avatarUrl) logEmbed.setThumbnail(robloxData.avatarUrl);
                logEmbed.addFields({ name: "Profile", value: "[View Profile](" + robloxData.profileUrl + ")", inline: false });
            } else {
                logEmbed.addFields({ name: "Roblox Lookup", value: "❌ User not found", inline: false });
            }

            await sendStaffLog(guild, logEmbed);
            await sendLog(guild, logEmbed);
            await sendWebhook(guild, logEmbed);
            return message.reply({ embeds: [createSuccessEmbed("Punishment log recorded for **" + username + "**.")] });
        }

    } catch (error) {
        console.error("Message command error:", error);
        try { await message.reply({ embeds: [createErrorEmbed("An error occurred.")] }); }
        catch (e) { /* ignore */ }
    }
});

// ==========================================
// WELCOME + LOGGING
// ==========================================

client.on("guildMemberAdd", async member => {
    try {
        const guild = member.guild;
        const gc = getGuildConfig(guild.id);

        if (gc.welcomeChannelId) {
            const channel = guild.channels.cache.get(gc.welcomeChannelId);
            if (channel) {
                const memberNumber = guild.memberCount;
                const suffix = getOrdinalSuffix(memberNumber);
                const welcomeText =
                    member.toString() +
                    " Hello, and welcome to **" + guild.name + "**! " +
                    "You are our **" + memberNumber + suffix + "** member, enjoy your stay!";
                await channel.send({ content: welcomeText });
            }
        }

        const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);
        const embed = createLogEmbed("Member Joined",
            "**User:** " + member + " (" + member.user.tag + ")\n" +
            "**ID:** " + member.id + "\n" +
            "**Account Created:** <t:" + Math.floor(member.user.createdTimestamp / 1000) + ":R> (" + accountAge + " days ago)\n" +
            "**Member Count:** " + guild.memberCount,
            0x57F287
        );
        await sendLog(guild, embed);
        await sendWebhook(guild, embed);
    } catch (error) { console.error("guildMemberAdd error:", error); }
});

client.on("guildMemberRemove", async member => {
    try {
        const roles = member.roles?.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(", ") || "None";
        const joinedAt = member.joinedTimestamp ? "<t:" + Math.floor(member.joinedTimestamp / 1000) + ":R>" : "Unknown";
        const embed = createLogEmbed("Member Left",
            "**User:** " + member.user.tag + "\n**ID:** " + member.id + "\n**Joined:** " + joinedAt + "\n**Roles:** " + roles,
            0xED4245
        );
        await sendLog(member.guild, embed);
        await sendWebhook(member.guild, embed);
    } catch (error) { console.error("guildMemberRemove error:", error); }
});

client.on("guildMemberUpdate", async (oldMember, newMember) => {
    try {
        const changes = [];
        if (oldMember.nickname !== newMember.nickname) {
            changes.push("**Nickname:** " + (oldMember.nickname || "None") + " → " + (newMember.nickname || "None"));
        }
        const addedRoles = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
        const removedRoles = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id));
        if (addedRoles.size > 0) changes.push("**Roles Added:** " + addedRoles.map(r => r.toString()).join(", "));
        if (removedRoles.size > 0) changes.push("**Roles Removed:** " + removedRoles.map(r => r.toString()).join(", "));
        if (oldMember.communicationDisabledUntilTimestamp !== newMember.communicationDisabledUntilTimestamp) {
            changes.push(newMember.communicationDisabledUntilTimestamp
                ? "**Timed out until:** <t:" + Math.floor(newMember.communicationDisabledUntilTimestamp / 1000) + ":F>"
                : "**Timeout removed**");
        }
        if (changes.length === 0) return;

        const embed = createLogEmbed("Member Updated",
            "**User:** " + newMember + " (" + newMember.user.tag + ")\n\n" + changes.join("\n"),
            0xFEE75C
        );
        await sendLog(newMember.guild, embed);
        await sendWebhook(newMember.guild, embed);
    } catch (error) { console.error("guildMemberUpdate error:", error); }
});

client.on("guildBanAdd", async ban => {
    try {
        const embed = createLogEmbed("Member Banned",
            "**User:** " + ban.user.tag + "\n**ID:** " + ban.user.id + "\n**Reason:** " + (ban.reason || "No reason provided"),
            0xED4245
        );
        await sendLog(ban.guild, embed);
        await sendWebhook(ban.guild, embed);
    } catch (e) { console.error("guildBanAdd error:", e); }
});

client.on("guildBanRemove", async ban => {
    try {
        const embed = createLogEmbed("Member Unbanned", "**User:** " + ban.user.tag + "\n**ID:** " + ban.user.id, 0x57F287);
        await sendLog(ban.guild, embed);
        await sendWebhook(ban.guild, embed);
    } catch (e) { console.error("guildBanRemove error:", e); }
});

client.on("messageDelete", async message => {
    try {
        if (!message.guild || message.author?.bot) return;
        const embed = createLogEmbed("Message Deleted",
            "**Author:** " + (message.author?.tag || "Unknown") + " (" + (message.author?.id || "Unknown") + ")\n" +
            "**Channel:** " + message.channel + "\n" +
            "**Content:** " + (message.content || "*Unavailable*").slice(0, 1500),
            0xED4245
        );
        await sendLog(message.guild, embed);
    } catch (e) { console.error("messageDelete error:", e); }
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
    try {
        if (!oldMessage.guild || oldMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return;
        const embed = createLogEmbed("Message Edited",
            "**Author:** " + (oldMessage.author?.tag || "Unknown") + "\n" +
            "**Channel:** " + oldMessage.channel + "\n" +
            "**Jump:** [Click here](" + newMessage.url + ")\n\n" +
            "**Before:** " + (oldMessage.content || "*Unavailable*").slice(0, 800) + "\n" +
            "**After:** " + (newMessage.content || "*Unavailable*").slice(0, 800),
            0xFEE75C
        );
        await sendLog(oldMessage.guild, embed);
    } catch (e) { console.error("messageUpdate error:", e); }
});

client.on("roleCreate", async role => {
    try {
        const embed = createLogEmbed("Role Created", "**Role:** " + role + "\n**Name:** " + role.name + "\n**ID:** " + role.id, 0x57F287);
        await sendLog(role.guild, embed);
    } catch (e) { console.error("roleCreate error:", e); }
});

client.on("roleDelete", async role => {
    try {
        const embed = createLogEmbed("Role Deleted", "**Role:** " + role.name + "\n**ID:** " + role.id, 0xED4245);
        await sendLog(role.guild, embed);
    } catch (e) { console.error("roleDelete error:", e); }
});

client.on("roleUpdate", async (oldRole, newRole) => {
    try {
        const changes = [];
        if (oldRole.name !== newRole.name) changes.push("**Name:** " + oldRole.name + " → " + newRole.name);
        if (oldRole.hexColor !== newRole.hexColor) changes.push("**Color:** " + oldRole.hexColor + " → " + newRole.hexColor);
        if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push("**Permissions changed**");
        if (changes.length === 0) return;
        await sendLog(newRole.guild, createLogEmbed("Role Updated", "**Role:** " + newRole + "\n\n" + changes.join("\n"), 0xFEE75C));
    } catch (e) { console.error("roleUpdate error:", e); }
});

client.on("channelCreate", async channel => {
    try {
        if (!channel.guild) return;
        await sendLog(channel.guild, createLogEmbed("Channel Created",
            "**Channel:** " + channel + "\n**Name:** " + channel.name + "\n**ID:** " + channel.id, 0x57F287));
    } catch (e) { console.error("channelCreate error:", e); }
});

client.on("channelDelete", async channel => {
    try {
        if (!channel.guild) return;
        await sendLog(channel.guild, createLogEmbed("Channel Deleted",
            "**Name:** " + channel.name + "\n**ID:** " + channel.id, 0xED4245));
    } catch (e) { console.error("channelDelete error:", e); }
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
    try {
        if (!newChannel.guild) return;
        const changes = [];
        if (oldChannel.name !== newChannel.name) changes.push("**Name:** " + oldChannel.name + " → " + newChannel.name);
        if (oldChannel.parentId !== newChannel.parentId) changes.push("**Category changed**");
        if (changes.length === 0) return;
        await sendLog(newChannel.guild, createLogEmbed("Channel Updated",
            "**Channel:** " + newChannel + "\n\n" + changes.join("\n"), 0xFEE75C));
    } catch (e) { console.error("channelUpdate error:", e); }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
        const member = newState.member || oldState.member;
        if (!member) return;
        if (!oldState.channelId && newState.channelId) {
            await sendLog(member.guild, createLogEmbed("Voice Joined", "**User:** " + member + "\n**Channel:** " + newState.channel, 0x57F287));
        } else if (oldState.channelId && !newState.channelId) {
            await sendLog(member.guild, createLogEmbed("Voice Left", "**User:** " + member + "\n**Channel:** " + oldState.channel, 0xED4245));
        } else if (oldState.channelId !== newState.channelId) {
            await sendLog(member.guild, createLogEmbed("Voice Switched", "**User:** " + member + "\n**From:** " + oldState.channel + "\n**To:** " + newState.channel, 0xFEE75C));
        }
    } catch (e) { console.error("voiceStateUpdate error:", e); }
});

// ==========================================
// GLOBAL ERROR HANDLING
// ==========================================

client.on("error", error => console.error("Discord client error:", error));
client.on("warn", warning => console.warn("Discord client warning:", warning));

process.on("unhandledRejection", error => console.error("Unhandled promise rejection:", error));
process.on("uncaughtException", error => console.error("Uncaught exception:", error));

// ==========================================
// LOGIN
// ==========================================

client.login(TOKEN);