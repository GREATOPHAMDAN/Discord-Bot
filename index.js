// ==========================================
// EAGLE COUNTY ROLEPLAY BOT
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
    ChannelType
} = require("discord.js");

const fs = require("fs");
const path = require("path");
const dotenv = require("dotenv");

dotenv.config();

const TOKEN = process.env.TOKEN;

if (!TOKEN) {
    console.error("ERROR: TOKEN is missing from .env");
    process.exit(1);
}

// ==========================================
// CONFIGURATION CONSTANTS
// ==========================================

const CONFIG_FILE = path.join(__dirname, "config.json");
const DEFAULT_PREFIX = "!";
const DAILY_LIMIT = 15;

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
        acceptRoleId: null,
        staffRoles: [],
        adminRoles: [],
        exemptRoles: [],
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
    try {
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 4));
    } catch (error) {
        console.error("Failed to save config:", error);
    }
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
    return gc;
}

// ==========================================
// UTILITIES
// ==========================================

function getToday() {
    return new Date().toISOString().split("T")[0];
}

function getLimitData(guildId, userId) {
    const gc = getGuildConfig(guildId);
    const today = getToday();
    if (!gc.limits[userId] || gc.limits[userId].date !== today) {
        gc.limits[userId] = { date: today, mutes: 0, kicks: 0 };
    }
    return gc.limits[userId];
}

function getPrefix(guildId) {
    return getGuildConfig(guildId).prefix || DEFAULT_PREFIX;
}

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

// ==========================================
// EMBEDS
// ==========================================

function createLogEmbed(title, description, color = 0x808080) {
    return new EmbedBuilder()
        .setTitle(title)
        .setDescription(description)
        .setColor(color)
        .setTimestamp();
}

function createErrorEmbed(description) {
    return new EmbedBuilder()
        .setTitle("Error")
        .setDescription(description)
        .setColor(0xED4245)
        .setTimestamp();
}

function createSuccessEmbed(description) {
    return new EmbedBuilder()
        .setTitle("Success")
        .setDescription(description)
        .setColor(0x57F287)
        .setTimestamp();
}

// ==========================================
// LOGGING HELPERS
// ==========================================

async function sendLog(guild, embed) {
    try {
        const gc = getGuildConfig(guild.id);
        if (!gc.logChannelId) return;
        const channel = guild.channels.cache.get(gc.logChannelId);
        if (!channel) return;
        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error("Failed to send log:", error);
    }
}

async function sendStaffLog(guild, embed) {
    try {
        const gc = getGuildConfig(guild.id);
        if (!gc.staffLogChannelId) return;
        const channel = guild.channels.cache.get(gc.staffLogChannelId);
        if (!channel) return;
        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error("Failed to send staff log:", error);
    }
}

async function sendHRLog(guild, embed) {
    try {
        const gc = getGuildConfig(guild.id);
        if (!gc.hrLogChannelId) return;
        const channel = guild.channels.cache.get(gc.hrLogChannelId);
        if (!channel) return;
        await channel.send({ embeds: [embed] });
    } catch (error) {
        console.error("Failed to send HR log:", error);
    }
}

// ==========================================
// DURATION PARSER
// ==========================================

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
                if (avatarData.data && avatarData.data.length > 0) {
                    avatarUrl = avatarData.data[0].imageUrl;
                }
            }
        } catch (e) {
            console.error("Failed to fetch Roblox avatar:", e);
        }

        return {
            id: userId,
            username: details.name,
            displayName: details.displayName,
            description: details.description || "No description",
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
// SUGGESTION / FEEDBACK EMBEDS
// ==========================================

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
        new ButtonBuilder()
            .setCustomId("vote_up_" + type + "_" + id)
            .setLabel("Upvote")
            .setEmoji("👍")
            .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
            .setCustomId("vote_down_" + type + "_" + id)
            .setLabel("Downvote")
            .setEmoji("👎")
            .setStyle(ButtonStyle.Danger)
    );
}

// ==========================================
// SLASH COMMANDS
// ==========================================

function getSlashCommands() {
    const commands = [
        new SlashCommandBuilder().setName("setup").setDescription("Show the server bot setup"),
        new SlashCommandBuilder().setName("help").setDescription("Show bot commands"),

        new SlashCommandBuilder()
            .setName("setprefix")
            .setDescription("Set the server prefix")
            .addStringOption(o => o.setName("prefix").setDescription("New prefix").setRequired(true).setMaxLength(5)),

        // ----- CHANNEL CONFIG -----
        new SlashCommandBuilder().setName("set-logs").setDescription("Set the logging channel")
            .addChannelOption(o => o.setName("channel").setDescription("Logging channel").setRequired(true)),
        new SlashCommandBuilder().setName("remove-logs").setDescription("Remove the logging channel"),

        new SlashCommandBuilder().setName("set-welcome").setDescription("Set the welcome channel")
            .addChannelOption(o => o.setName("channel").setDescription("Welcome channel").setRequired(true)),
        new SlashCommandBuilder().setName("remove-welcome").setDescription("Remove the welcome channel"),

        new SlashCommandBuilder().setName("set-suggestions").setDescription("Set the suggestions channel")
            .addChannelOption(o => o.setName("channel").setDescription("Suggestions channel").setRequired(true)),
        new SlashCommandBuilder().setName("remove-suggestions").setDescription("Remove the suggestions channel"),

        new SlashCommandBuilder().setName("set-staff-feedback").setDescription("Set the staff feedback channel")
            .addChannelOption(o => o.setName("channel").setDescription("Staff feedback channel").setRequired(true)),
        new SlashCommandBuilder().setName("remove-staff-feedback").setDescription("Remove the staff feedback channel"),

        new SlashCommandBuilder().setName("set-staff-logs").setDescription("Set the staff punishment log channel")
            .addChannelOption(o => o.setName("channel").setDescription("Staff log channel").setRequired(true)),
        new SlashCommandBuilder().setName("remove-staff-logs").setDescription("Remove the staff log channel"),

        new SlashCommandBuilder().setName("set-hr-logs").setDescription("Set the HR (promotion/demotion) log channel")
            .addChannelOption(o => o.setName("channel").setDescription("HR log channel").setRequired(true)),
        new SlashCommandBuilder().setName("remove-hr-logs").setDescription("Remove the HR log channel"),

        // ----- ROLE CONFIG -----
        new SlashCommandBuilder().setName("set-staff").setDescription("Add a staff role")
            .addRoleOption(o => o.setName("role").setDescription("Staff role").setRequired(true)),
        new SlashCommandBuilder().setName("remove-staff").setDescription("Remove a staff role")
            .addRoleOption(o => o.setName("role").setDescription("Staff role").setRequired(true)),

        new SlashCommandBuilder().setName("set-admin").setDescription("Add an admin role")
            .addRoleOption(o => o.setName("role").setDescription("Admin role").setRequired(true)),
        new SlashCommandBuilder().setName("remove-admin").setDescription("Remove an admin role")
            .addRoleOption(o => o.setName("role").setDescription("Admin role").setRequired(true)),

        new SlashCommandBuilder().setName("set-exempt").setDescription("Add an exempt role")
            .addRoleOption(o => o.setName("role").setDescription("Exempt role").setRequired(true)),
        new SlashCommandBuilder().setName("remove-exempt").setDescription("Remove an exempt role")
            .addRoleOption(o => o.setName("role").setDescription("Exempt role").setRequired(true)),

        // ----- ACCEPT / APPLICATION SETUP -----
        new SlashCommandBuilder()
            .setName("acceptsetup")
            .setDescription("Set the role that /accept gives to a user")
            .addRoleOption(o => o.setName("role").setDescription("Role to give on accept").setRequired(true)),

        new SlashCommandBuilder()
            .setName("accept")
            .setDescription("Accept a user's application (DMs them)")
            .addUserOption(o => o.setName("user").setDescription("User to accept").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Notes about the application").setRequired(false)),

        // ----- HR: PROMOTE / DEMOTE -----
        new SlashCommandBuilder()
            .setName("promote")
            .setDescription("Promote a user (DMs them)")
            .addUserOption(o => o.setName("user").setDescription("User to promote").setRequired(true))
            .addStringOption(o => o.setName("rank").setDescription("New rank/position").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Notes").setRequired(false)),

        new SlashCommandBuilder()
            .setName("demote")
            .setDescription("Demote a user (DMs them)")
            .addUserOption(o => o.setName("user").setDescription("User to demote").setRequired(true))
            .addStringOption(o => o.setName("rank").setDescription("New rank/position").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Notes").setRequired(false)),

        // ----- PUNISH -----
        new SlashCommandBuilder()
            .setName("punish")
            .setDescription("Punish a user (warn/strike/demotion/suspension)")
            .addUserOption(o => o.setName("user").setDescription("User to punish").setRequired(true))
            .addStringOption(o => o
                .setName("type")
                .setDescription("Punishment type")
                .setRequired(true)
                .addChoices(
                    { name: "Warn", value: "warn" },
                    { name: "Strike", value: "strike" },
                    { name: "Demotion", value: "demotion" },
                    { name: "Suspension", value: "suspension" }
                ))
            .addStringOption(o => o.setName("reason").setDescription("Reason").setRequired(true))
            .addStringOption(o => o.setName("notes").setDescription("Additional notes").setRequired(false)),

        // ----- SUGGESTIONS / FEEDBACK -----
        new SlashCommandBuilder()
            .setName("suggest")
            .setDescription("Submit a suggestion")
            .addStringOption(o => o.setName("suggestion").setDescription("Your suggestion").setRequired(true)),

        new SlashCommandBuilder()
            .setName("staff-feedback")
            .setDescription("Submit feedback about a staff member")
            .addUserOption(o => o.setName("staff").setDescription("Staff member").setRequired(true))
            .addStringOption(o => o.setName("feedback").setDescription("Your feedback").setRequired(true)),

        // ----- MODERATION -----
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

        // ----- LOGUSER -----
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

    client.user.setActivity("Eagle County Roleplay");
});

client.on("guildCreate", async guild => {
    getGuildConfig(guild.id);
    await registerCommands(guild);
    console.log("Joined server: " + guild.name);
});

// ==========================================
// HELPER: Accept / DM / HR embed builders
// ==========================================

function buildAcceptDM(guild, notes) {
    const embed = new EmbedBuilder()
        .setTitle("Application Accepted")
        .setColor(0x57F287)
        .setDescription(
            "Congratulations! Your application for **" + guild.name + "** has been **accepted**.\n\n" +
            "Please review the server for next steps. If you have questions, reach out to a staff member."
        )
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) })
        .setTimestamp();

    if (notes) {
        embed.addFields({ name: "Notes from Staff", value: notes.slice(0, 1024), inline: false });
    }

    return embed;
}

function buildPromotionDM(guild, rank, notes) {
    const embed = new EmbedBuilder()
        .setTitle("You Have Been Promoted")
        .setColor(0x57F287)
        .setDescription(
            "You have been **promoted** in **" + guild.name + "**!\n\n" +
            "**New Rank:** " + rank
        )
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) })
        .setTimestamp();

    if (notes) {
        embed.addFields({ name: "Notes", value: notes.slice(0, 1024), inline: false });
    }

    return embed;
}

function buildDemotionDM(guild, rank, notes) {
    const embed = new EmbedBuilder()
        .setTitle("You Have Been Demoted")
        .setColor(0xED4245)
        .setDescription(
            "You have been **demoted** in **" + guild.name + "**.\n\n" +
            "**New Rank:** " + rank
        )
        .setFooter({ text: guild.name, iconURL: guild.iconURL({ dynamic: true }) })
        .setTimestamp();

    if (notes) {
        embed.addFields({ name: "Notes", value: notes.slice(0, 1024), inline: false });
    }

    return embed;
}

function buildPunishEmbed(userTag, userId, type, reason, notes, moderator) {
    const colors = {
        warn: 0xFEE75C,
        strike: 0xED4245,
        demotion: 0xED4245,
        suspension: 0x992D22
    };

    const embed = new EmbedBuilder()
        .setTitle("Punishment Issued")
        .setColor(colors[type] || 0xED4245)
        .addFields(
            { name: "User", value: userTag + " (" + userId + ")", inline: false },
            { name: "Punishment", value: type.charAt(0).toUpperCase() + type.slice(1), inline: true },
            { name: "Moderator", value: moderator, inline: true },
            { name: "Reason", value: reason, inline: false }
        )
        .setTimestamp();

    if (notes) {
        embed.addFields({ name: "Notes", value: notes.slice(0, 1024), inline: false });
    }

    return embed;
}

// ==========================================
// INTERACTION HANDLER
// ==========================================

client.on("interactionCreate", async interaction => {
    try {
        if (interaction.isButton()) {
            return handleVoteButton(interaction);
        }

        if (!interaction.isChatInputCommand()) return;

        const guild = interaction.guild;
        if (!guild) return;

        const guildConfig = getGuildConfig(guild.id);
        const command = interaction.commandName;

        // ---------- SETUP ----------
        if (command === "setup") {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You need administrator permissions.")], ephemeral: true });
            }

            const embed = new EmbedBuilder()
                .setTitle(guild.name + " Bot Setup")
                .setColor(0x808080)
                .setThumbnail(guild.iconURL({ dynamic: true }))
                .addFields(
                    { name: "Prefix", value: "`" + guildConfig.prefix + "`", inline: true },
                    { name: "Logs", value: guildConfig.logChannelId ? "<#" + guildConfig.logChannelId + ">" : "Not set", inline: true },
                    { name: "Welcome", value: guildConfig.welcomeChannelId ? "<#" + guildConfig.welcomeChannelId + ">" : "Not set", inline: true },
                    { name: "Suggestions", value: guildConfig.suggestionChannelId ? "<#" + guildConfig.suggestionChannelId + ">" : "Not set", inline: true },
                    { name: "Staff Feedback", value: guildConfig.staffFeedbackChannelId ? "<#" + guildConfig.staffFeedbackChannelId + ">" : "Not set", inline: true },
                    { name: "Staff Logs", value: guildConfig.staffLogChannelId ? "<#" + guildConfig.staffLogChannelId + ">" : "Not set", inline: true },
                    { name: "HR Logs", value: guildConfig.hrLogChannelId ? "<#" + guildConfig.hrLogChannelId + ">" : "Not set", inline: true },
                    { name: "Accept Role", value: guildConfig.acceptRoleId ? "<@&" + guildConfig.acceptRoleId + ">" : "Not set", inline: true },
                    { name: "Staff Roles", value: guildConfig.staffRoles.length ? guildConfig.staffRoles.map(id => "<@&" + id + ">").join(", ") : "None", inline: false },
                    { name: "Admin Roles", value: guildConfig.adminRoles.length ? guildConfig.adminRoles.map(id => "<@&" + id + ">").join(", ") : "None", inline: false },
                    { name: "Exempt Roles", value: guildConfig.exemptRoles.length ? guildConfig.exemptRoles.map(id => "<@&" + id + ">").join(", ") : "None", inline: false }
                );

            return interaction.reply({ embeds: [embed], ephemeral: true });
        }

        // ---------- SETPREFIX ----------
        if (command === "setprefix") {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You need administrator permissions.")], ephemeral: true });
            }
            const prefix = interaction.options.getString("prefix");
            if (/\s/.test(prefix)) {
                return interaction.reply({ embeds: [createErrorEmbed("The prefix cannot contain spaces.")], ephemeral: true });
            }
            guildConfig.prefix = prefix;
            saveConfig();
            return interaction.reply({ embeds: [createSuccessEmbed("Prefix changed to `" + prefix + "`.")] });
        }

        // ---------- CHANNEL CONFIG ----------
        const channelConfigMap = {
            "set-logs": { key: "logChannelId", name: "Logging" },
            "remove-logs": { key: "logChannelId", name: "Logging", remove: true },
            "set-welcome": { key: "welcomeChannelId", name: "Welcome" },
            "remove-welcome": { key: "welcomeChannelId", name: "Welcome", remove: true },
            "set-suggestions": { key: "suggestionChannelId", name: "Suggestions" },
            "remove-suggestions": { key: "suggestionChannelId", name: "Suggestions", remove: true },
            "set-staff-feedback": { key: "staffFeedbackChannelId", name: "Staff Feedback" },
            "remove-staff-feedback": { key: "staffFeedbackChannelId", name: "Staff Feedback", remove: true },
            "set-staff-logs": { key: "staffLogChannelId", name: "Staff Logs" },
            "remove-staff-logs": { key: "staffLogChannelId", name: "Staff Logs", remove: true },
            "set-hr-logs": { key: "hrLogChannelId", name: "HR Logs" },
            "remove-hr-logs": { key: "hrLogChannelId", name: "HR Logs", remove: true }
        };

        if (channelConfigMap[command]) {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You need administrator permissions.")], ephemeral: true });
            }
            const cfg = channelConfigMap[command];
            if (cfg.remove) {
                guildConfig[cfg.key] = null;
                saveConfig();
                return interaction.reply({ embeds: [createSuccessEmbed(cfg.name + " channel has been removed.")] });
            }
            const channel = interaction.options.getChannel("channel");
            guildConfig[cfg.key] = channel.id;
            saveConfig();
            return interaction.reply({ embeds: [createSuccessEmbed(cfg.name + " channel set to " + channel + ".")] });
        }

        // ---------- ROLE CONFIG ----------
        const roleConfigMap = {
            "set-staff": { key: "staffRoles", name: "staff", add: true },
            "remove-staff": { key: "staffRoles", name: "staff", add: false },
            "set-admin": { key: "adminRoles", name: "admin", add: true },
            "remove-admin": { key: "adminRoles", name: "admin", add: false },
            "set-exempt": { key: "exemptRoles", name: "exempt", add: true },
            "remove-exempt": { key: "exemptRoles", name: "exempt", add: false }
        };

        if (roleConfigMap[command]) {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You need administrator permissions.")], ephemeral: true });
            }
            const cfg = roleConfigMap[command];
            const role = interaction.options.getRole("role");

            if (cfg.add) {
                if (guildConfig[cfg.key].includes(role.id)) {
                    return interaction.reply({ embeds: [createErrorEmbed(role + " is already a " + cfg.name + " role.")], ephemeral: true });
                }
                guildConfig[cfg.key].push(role.id);
                saveConfig();
                return interaction.reply({ embeds: [createSuccessEmbed(role + " has been added as a " + cfg.name + " role.")] });
            } else {
                if (!guildConfig[cfg.key].includes(role.id)) {
                    return interaction.reply({ embeds: [createErrorEmbed(role + " is not a " + cfg.name + " role.")], ephemeral: true });
                }
                guildConfig[cfg.key] = guildConfig[cfg.key].filter(id => id !== role.id);
                saveConfig();
                return interaction.reply({ embeds: [createSuccessEmbed(role + " has been removed from " + cfg.name + " roles.")] });
            }
        }

        // ---------- ACCEPT SETUP ----------
        if (command === "acceptsetup") {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You need administrator permissions.")], ephemeral: true });
            }
            const role = interaction.options.getRole("role");
            guildConfig.acceptRoleId = role.id;
            saveConfig();
            return interaction.reply({ embeds: [createSuccessEmbed("Accept role set to " + role + ". Users accepted with `/accept` will receive this role.")] });
        }

        // ---------- ACCEPT ----------
        if (command === "accept") {
            if (!isStaff(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You do not have permission to accept applications.")], ephemeral: true });
            }

            const targetUser = interaction.options.getUser("user");
            const notes = interaction.options.getString("notes") || null;

            await interaction.deferReply();

            // Try to give role if configured
            let roleGiven = false;
            if (guildConfig.acceptRoleId) {
                const member = await guild.members.fetch(targetUser.id).catch(() => null);
                if (member) {
                    try {
                        await member.roles.add(guildConfig.acceptRoleId, "Application accepted");
                        roleGiven = true;
                    } catch (e) {
                        console.error("Failed to add accept role:", e);
                    }
                }
            }

            // Send DM
            let dmSent = false;
            try {
                await targetUser.send({ embeds: [buildAcceptDM(guild, notes)] });
                dmSent = true;
            } catch (e) {
                console.error("Failed to DM user:", e);
            }

            // Log
            const logEmbed = new EmbedBuilder()
                .setTitle("Application Accepted")
                .setColor(0x57F287)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "Accepted By", value: interaction.user.tag, inline: true },
                    { name: "Role Given", value: roleGiven ? "<@&" + guildConfig.acceptRoleId + ">" : "None / Not set", inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No (DMs closed)", inline: true }
                )
                .setTimestamp();

            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024), inline: false });

            await sendHRLog(guild, logEmbed);
            await sendLog(guild, logEmbed);

            return interaction.editReply({
                embeds: [createSuccessEmbed(
                    "**" + targetUser.tag + "**'s application has been accepted." +
                    (dmSent ? " DM sent." : " (Could not DM — DMs closed.)") +
                    (roleGiven ? " Role given." : "")
                )]
            });
        }

        // ---------- PROMOTE ----------
        if (command === "promote") {
            if (!isStaff(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You do not have permission to promote.")], ephemeral: true });
            }

            const targetUser = interaction.options.getUser("user");
            const rank = interaction.options.getString("rank");
            const notes = interaction.options.getString("notes") || null;

            await interaction.deferReply();

            let dmSent = false;
            try {
                await targetUser.send({ embeds: [buildPromotionDM(guild, rank, notes)] });
                dmSent = true;
            } catch (e) {
                console.error("DM failed:", e);
            }

            const logEmbed = new EmbedBuilder()
                .setTitle("Promotion")
                .setColor(0x57F287)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "New Rank", value: rank, inline: true },
                    { name: "Promoted By", value: interaction.user.tag, inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No (DMs closed)", inline: true }
                )
                .setTimestamp();

            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024), inline: false });

            await sendHRLog(guild, logEmbed);
            await sendLog(guild, logEmbed);

            return interaction.editReply({
                embeds: [createSuccessEmbed("**" + targetUser.tag + "** has been promoted to **" + rank + "**." + (dmSent ? " DM sent." : " (Could not DM.)"))]
            });
        }

        // ---------- DEMOTE ----------
        if (command === "demote") {
            if (!isStaff(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You do not have permission to demote.")], ephemeral: true });
            }

            const targetUser = interaction.options.getUser("user");
            const rank = interaction.options.getString("rank");
            const notes = interaction.options.getString("notes") || null;

            await interaction.deferReply();

            let dmSent = false;
            try {
                await targetUser.send({ embeds: [buildDemotionDM(guild, rank, notes)] });
                dmSent = true;
            } catch (e) {
                console.error("DM failed:", e);
            }

            const logEmbed = new EmbedBuilder()
                .setTitle("Demotion")
                .setColor(0xED4245)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "New Rank", value: rank, inline: true },
                    { name: "Demoted By", value: interaction.user.tag, inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No (DMs closed)", inline: true }
                )
                .setTimestamp();

            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024), inline: false });

            await sendHRLog(guild, logEmbed);
            await sendLog(guild, logEmbed);

            return interaction.editReply({
                embeds: [createSuccessEmbed("**" + targetUser.tag + "** has been demoted to **" + rank + "**." + (dmSent ? " DM sent." : " (Could not DM.)"))]
            });
        }

        // ---------- PUNISH ----------
        if (command === "punish") {
            if (!isStaff(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You do not have permission to punish.")], ephemeral: true });
            }

            const targetUser = interaction.options.getUser("user");
            const type = interaction.options.getString("type");
            const reason = interaction.options.getString("reason");
            const notes = interaction.options.getString("notes") || null;

            const embed = buildPunishEmbed(
                targetUser.tag,
                targetUser.id,
                type,
                reason,
                notes,
                interaction.user.tag
            );

            await sendHRLog(guild, embed);
            await sendLog(guild, embed);

            return interaction.reply({
                embeds: [createSuccessEmbed("**" + targetUser.tag + "** has been punished: **" + type + "**.")]
            });
        }

        // ---------- SUGGEST ----------
        if (command === "suggest") {
            if (!guildConfig.suggestionChannelId) {
                return interaction.reply({ embeds: [createErrorEmbed("Suggestions channel is not set up.")], ephemeral: true });
            }

            const suggestion = interaction.options.getString("suggestion");
            const suggestionChannel = guild.channels.cache.get(guildConfig.suggestionChannelId);

            if (!suggestionChannel) {
                return interaction.reply({ embeds: [createErrorEmbed("Suggestions channel could not be found.")], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const initialEmbed = buildSuggestionEmbed(suggestion, interaction.user, 0, 0);
            const sentMessage = await suggestionChannel.send({
                embeds: [initialEmbed],
                components: [buildVoteRow("pending", "suggestion")]
            });

            const finalEmbed = buildSuggestionEmbed(suggestion, interaction.user, 0, 0);
            const finalRow = buildVoteRow(sentMessage.id, "suggestion");
            await sentMessage.edit({ embeds: [finalEmbed], components: [finalRow] });

            guildConfig.suggestions[sentMessage.id] = {
                authorId: interaction.user.id,
                content: suggestion,
                upvotes: [],
                downvotes: [],
                createdAt: Date.now()
            };
            saveConfig();

            return interaction.editReply({ embeds: [createSuccessEmbed("Your suggestion has been submitted!")] });
        }

        // ---------- STAFF FEEDBACK ----------
        if (command === "staff-feedback") {
            if (!guildConfig.staffFeedbackChannelId) {
                return interaction.reply({ embeds: [createErrorEmbed("Staff feedback channel is not set up.")], ephemeral: true });
            }

            const staffMember = interaction.options.getUser("staff");
            const feedback = interaction.options.getString("feedback");
            const feedbackChannel = guild.channels.cache.get(guildConfig.staffFeedbackChannelId);

            if (!feedbackChannel) {
                return interaction.reply({ embeds: [createErrorEmbed("Staff feedback channel could not be found.")], ephemeral: true });
            }

            await interaction.deferReply({ ephemeral: true });

            const initialEmbed = buildStaffFeedbackEmbed(staffMember, feedback, interaction.user, 0, 0);
            const sentMessage = await feedbackChannel.send({
                embeds: [initialEmbed],
                components: [buildVoteRow("pending", "feedback")]
            });

            const finalEmbed = buildStaffFeedbackEmbed(staffMember, feedback, interaction.user, 0, 0);
            const finalRow = buildVoteRow(sentMessage.id, "feedback");
            await sentMessage.edit({ embeds: [finalEmbed], components: [finalRow] });

            guildConfig.staffFeedback[sentMessage.id] = {
                authorId: interaction.user.id,
                staffId: staffMember.id,
                content: feedback,
                upvotes: [],
                downvotes: [],
                createdAt: Date.now()
            };
            saveConfig();

            return interaction.editReply({ embeds: [createSuccessEmbed("Your feedback has been submitted!")] });
        }

        // ---------- MUTE ----------
        if (command === "mute") {
            if (!isStaff(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You do not have permission to mute members.")], ephemeral: true });
            }
            const targetUser = interaction.options.getUser("user");
            const target = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [createErrorEmbed("That member could not be found.")], ephemeral: true });
            if (isExempt(target)) return interaction.reply({ embeds: [createErrorEmbed("That member has an exempt role.")], ephemeral: true });
            if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [createErrorEmbed("You cannot moderate this member.")], ephemeral: true });

            const durationInput = interaction.options.getString("duration");
            const duration = parseDuration(durationInput);
            if (!duration) return interaction.reply({ embeds: [createErrorEmbed("Invalid duration. Examples: 10m, 1h, 1d.")], ephemeral: true });

            const limit = getLimitData(guild.id, interaction.user.id);
            if (limit.mutes >= DAILY_LIMIT) {
                return interaction.reply({ embeds: [createErrorEmbed("You have reached your daily limit of " + DAILY_LIMIT + " mutes.")], ephemeral: true });
            }

            const reason = interaction.options.getString("reason") || "No reason provided";

            try {
                await target.timeout(duration, reason);
                limit.mutes++;
                saveConfig();

                await sendLog(guild, createLogEmbed(
                    "Member Muted",
                    "**User:** " + target + "\n**Moderator:** " + interaction.user + "\n**Duration:** " + durationInput + "\n**Reason:** " + reason + "\n**Daily Mutes:** " + limit.mutes + "/" + DAILY_LIMIT
                ));

                return interaction.reply({ embeds: [createSuccessEmbed(target + " has been muted for **" + durationInput + "**.")] });
            } catch (error) {
                console.error(error);
                return interaction.reply({ embeds: [createErrorEmbed("I could not mute that member.")], ephemeral: true });
            }
        }

        // ---------- UNMUTE ----------
        if (command === "unmute") {
            if (!isStaff(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You do not have permission to unmute members.")], ephemeral: true });
            }
            const targetUser = interaction.options.getUser("user");
            const target = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [createErrorEmbed("That member could not be found.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                await target.timeout(null, reason);
                await sendLog(guild, createLogEmbed(
                    "Member Unmuted",
                    "**User:** " + target + "\n**Moderator:** " + interaction.user + "\n**Reason:** " + reason
                ));
                return interaction.reply({ embeds: [createSuccessEmbed(target + " has been unmuted.")] });
            } catch (error) {
                console.error(error);
                return interaction.reply({ embeds: [createErrorEmbed("I could not unmute that member.")], ephemeral: true });
            }
        }

        // ---------- KICK ----------
        if (command === "kick") {
            if (!isStaff(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You do not have permission to kick members.")], ephemeral: true });
            }
            const targetUser = interaction.options.getUser("user");
            const target = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [createErrorEmbed("That member could not be found.")], ephemeral: true });
            if (isExempt(target)) return interaction.reply({ embeds: [createErrorEmbed("That member has an exempt role.")], ephemeral: true });
            if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [createErrorEmbed("You cannot moderate this member.")], ephemeral: true });

            const limit = getLimitData(guild.id, interaction.user.id);
            if (limit.kicks >= DAILY_LIMIT) {
                return interaction.reply({ embeds: [createErrorEmbed("You have reached your daily limit of " + DAILY_LIMIT + " kicks.")], ephemeral: true });
            }
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                await target.kick(reason);
                limit.kicks++;
                saveConfig();
                await sendLog(guild, createLogEmbed(
                    "Member Kicked",
                    "**User:** " + target.user.tag + "\n**Moderator:** " + interaction.user + "\n**Reason:** " + reason + "\n**Daily Kicks:** " + limit.kicks + "/" + DAILY_LIMIT
                ));
                return interaction.reply({ embeds: [createSuccessEmbed(target.user.tag + " has been kicked.")] });
            } catch (error) {
                console.error(error);
                return interaction.reply({ embeds: [createErrorEmbed("I could not kick that member.")], ephemeral: true });
            }
        }

        // ---------- BAN ----------
        if (command === "ban") {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You do not have permission to ban members.")], ephemeral: true });
            }
            const targetUser = interaction.options.getUser("user");
            const target = await guild.members.fetch(targetUser.id).catch(() => null);
            if (!target) return interaction.reply({ embeds: [createErrorEmbed("That member could not be found.")], ephemeral: true });
            if (isExempt(target)) return interaction.reply({ embeds: [createErrorEmbed("That member has an exempt role.")], ephemeral: true });
            if (!canModerate(interaction.member, target)) return interaction.reply({ embeds: [createErrorEmbed("You cannot ban this member.")], ephemeral: true });
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                await target.ban({ reason });
                await sendLog(guild, createLogEmbed(
                    "Member Banned",
                    "**User:** " + target.user.tag + "\n**Moderator:** " + interaction.user + "\n**Reason:** " + reason
                ));
                return interaction.reply({ embeds: [createSuccessEmbed(target.user.tag + " has been banned.")] });
            } catch (error) {
                console.error(error);
                return interaction.reply({ embeds: [createErrorEmbed("I could not ban that member.")], ephemeral: true });
            }
        }

        // ---------- UNBAN ----------
        if (command === "unban") {
            if (!isAdmin(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You do not have permission to unban members.")], ephemeral: true });
            }
            const userId = interaction.options.getString("userid");
            const reason = interaction.options.getString("reason") || "No reason provided";
            try {
                const user = await client.users.fetch(userId);
                await guild.members.unban(userId, reason);
                await sendLog(guild, createLogEmbed(
                    "Member Unbanned",
                    "**User:** " + user.tag + "\n**Moderator:** " + interaction.user + "\n**Reason:** " + reason
                ));
                return interaction.reply({ embeds: [createSuccessEmbed(user.tag + " has been unbanned.")] });
            } catch (error) {
                console.error(error);
                return interaction.reply({ embeds: [createErrorEmbed("I could not unban that user.")], ephemeral: true });
            }
        }

        // ---------- LOGUSER ----------
        if (command === "loguser") {
            if (!isStaff(interaction.member)) {
                return interaction.reply({ embeds: [createErrorEmbed("You do not have permission to use this command.")], ephemeral: true });
            }
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
                    { name: "Profile", value: "[View Profile](" + robloxData.profileUrl + ")", inline: false },
                    { name: "Description", value: (robloxData.description || "No description").slice(0, 1024), inline: false }
                );
            } else {
                logEmbed.addFields({ name: "Roblox Lookup", value: "❌ User could not be found on Roblox", inline: false });
            }

            await sendStaffLog(guild, logEmbed);
            await sendLog(guild, logEmbed);

            return interaction.editReply({ embeds: [createSuccessEmbed("Punishment log for **" + username + "** has been recorded.")] });
        }

        // ---------- HELP ----------
        if (command === "help") {
            const prefix = getPrefix(guild.id);
            const embed = new EmbedBuilder()
                .setTitle(guild.name + " Bot Commands")
                .setColor(0x808080)
                .addFields(
                    { name: "General", value: ["`/help`", "`/setup`", "`/setprefix <prefix>`"].join("\n") },
                    { name: "Channel Configuration", value: [
                        "`/set-logs` `/remove-logs`",
                        "`/set-welcome` `/remove-welcome`",
                        "`/set-suggestions` `/remove-suggestions`",
                        "`/set-staff-feedback` `/remove-staff-feedback`",
                        "`/set-staff-logs` `/remove-staff-logs`",
                        "`/set-hr-logs` `/remove-hr-logs`"
                    ].join("\n") },
                    { name: "Role Configuration", value: [
                        "`/set-staff` `/remove-staff`",
                        "`/set-admin` `/remove-admin`",
                        "`/set-exempt` `/remove-exempt`",
                        "`/acceptsetup <role>`"
                    ].join("\n") },
                    { name: "HR / Applications", value: [
                        "`/accept <user> [notes]`",
                        "`/promote <user> <rank> [notes]`",
                        "`/demote <user> <rank> [notes]`",
                        "`/punish <user> <type> <reason> [notes]`"
                    ].join("\n") },
                    { name: "Suggestions & Feedback", value: [
                        "`/suggest <suggestion>`",
                        "`/staff-feedback <staff> <feedback>`"
                    ].join("\n") },
                    { name: "Moderation", value: [
                        "`/mute <user> <duration> [reason]`",
                        "`/unmute <user> [reason]`",
                        "`/kick <user> [reason]`",
                        "`/ban <user> [reason]`",
                        "`/unban <userid> [reason]`"
                    ].join("\n") },
                    { name: "Logging", value: [
                        "`/loguser <username> <punishment> <reason>`",
                        "`" + prefix + "loguser <username> <punishment> <reason>`"
                    ].join("\n") }
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
        } catch (e) {
            console.error("Failed to send error reply:", e);
        }
    }
});

// ==========================================
// VOTE BUTTON
// ==========================================

async function handleVoteButton(interaction) {
    try {
        const parts = interaction.customId.split("_");
        if (parts.length < 4) {
            return interaction.reply({ embeds: [createErrorEmbed("Invalid vote.")], ephemeral: true });
        }

        const direction = parts[1];
        const type = parts[2];
        const messageId = parts[3];

        const guildConfig = getGuildConfig(interaction.guild.id);
        const store = type === "suggestion" ? guildConfig.suggestions : guildConfig.staffFeedback;

        if (!store[messageId]) {
            return interaction.reply({ embeds: [createErrorEmbed("This vote is no longer valid.")], ephemeral: true });
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

        await interaction.message.edit({
            embeds: [updatedEmbed],
            components: [buildVoteRow(messageId, type)]
        });

        return interaction.reply({
            embeds: [createSuccessEmbed("You voted **" + (direction === "up" ? "up" : "down") + "**.")],
            ephemeral: true
        });

    } catch (error) {
        console.error("Vote error:", error);
        try {
            if (!interaction.replied && !interaction.deferred) {
                await interaction.reply({ embeds: [createErrorEmbed("Failed to process vote.")], ephemeral: true });
            }
        } catch (e) {
            console.error(e);
        }
    }
}

// ==========================================
// PREFIX COMMAND HANDLER
// ==========================================

client.on("messageCreate", async message => {
    if (message.author.bot) return;
    if (!message.guild) return;

    const prefix = getPrefix(message.guild.id);

    // IMPORTANT: use raw string comparison - this is what makes the prefix work
    if (!message.content.startsWith(prefix)) return;

    const args = message.content.slice(prefix.length).trim().split(/\s+/);
    const command = (args.shift() || "").toLowerCase();
    if (!command) return;

    const guild = message.guild;
    const guildConfig = getGuildConfig(guild.id);

    try {
        // ---------- HELP ----------
        if (command === "help") {
            const embed = new EmbedBuilder()
                .setTitle(guild.name + " Bot Commands")
                .setColor(0x808080)
                .addFields(
                    { name: "Prefix Commands", value: [
                        "`" + prefix + "help`",
                        "`" + prefix + "loguser <username> <punishment> <reason>`",
                        "`" + prefix + "accept <userId> [notes]`",
                        "`" + prefix + "promote <userId> <rank> [notes]`",
                        "`" + prefix + "demote <userId> <rank> [notes]`",
                        "`" + prefix + "punish <userId> <warn|strike|demotion|suspension> <reason>`"
                    ].join("\n") }
                );
            return message.reply({ embeds: [embed] });
        }

        // ---------- LOGUSER (PREFIX) ----------
        if (command === "loguser") {
            if (!isStaff(message.member)) {
                return message.reply({ embeds: [createErrorEmbed("You do not have permission to use this command.")] });
            }
            const username = args[0];
            const punishment = args[1];
            const reason = args.slice(2).join(" ");

            if (!username || !punishment || !reason) {
                return message.reply({
                    embeds: [createErrorEmbed("Usage: `" + prefix + "loguser <username> <punishment> <reason>`")]
                });
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
                    { name: "Logged At", value: "<t:" + Math.floor(Date.now() / 1000) + ":F>", inline: true },
                    { name: "Reason", value: reason, inline: false }
                )
                .setFooter({ text: "Logged by " + message.author.tag })
                .setTimestamp();

            if (robloxData) {
                if (robloxData.avatarUrl) logEmbed.setThumbnail(robloxData.avatarUrl);
                logEmbed.addFields(
                    { name: "Account Created", value: "<t:" + Math.floor(new Date(robloxData.created).getTime() / 1000) + ":F>", inline: false },
                    { name: "Profile", value: "[View Profile](" + robloxData.profileUrl + ")", inline: false },
                    { name: "Description", value: (robloxData.description || "No description").slice(0, 1024), inline: false }
                );
            } else {
                logEmbed.addFields({ name: "Roblox Lookup", value: "❌ User could not be found on Roblox", inline: false });
            }

            await sendStaffLog(guild, logEmbed);
            await sendLog(guild, logEmbed);

            return message.reply({
                embeds: [createSuccessEmbed("Punishment log for **" + username + "** has been recorded.")]
            });
        }

        // ---------- ACCEPT (PREFIX) ----------
        if (command === "accept") {
            if (!isStaff(message.member)) {
                return message.reply({ embeds: [createErrorEmbed("You do not have permission to accept applications.")] });
            }

            const userId = args[0];
            const notes = args.slice(1).join(" ") || null;

            if (!userId) {
                return message.reply({ embeds: [createErrorEmbed("Usage: `" + prefix + "accept <userId> [notes]`")] });
            }

            const targetUser = await client.users.fetch(userId).catch(() => null);
            if (!targetUser) return message.reply({ embeds: [createErrorEmbed("Could not find user with that ID.")] });

            let roleGiven = false;
            if (guildConfig.acceptRoleId) {
                const member = await guild.members.fetch(targetUser.id).catch(() => null);
                if (member) {
                    try {
                        await member.roles.add(guildConfig.acceptRoleId, "Application accepted");
                        roleGiven = true;
                    } catch (e) { console.error(e); }
                }
            }

            let dmSent = false;
            try {
                await targetUser.send({ embeds: [buildAcceptDM(guild, notes)] });
                dmSent = true;
            } catch (e) { console.error("DM failed:", e); }

            const logEmbed = new EmbedBuilder()
                .setTitle("Application Accepted")
                .setColor(0x57F287)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "Accepted By", value: message.author.tag, inline: true },
                    { name: "Role Given", value: roleGiven ? "<@&" + guildConfig.acceptRoleId + ">" : "None", inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No", inline: true }
                )
                .setTimestamp();

            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024), inline: false });

            await sendHRLog(guild, logEmbed);
            await sendLog(guild, logEmbed);

            return message.reply({
                embeds: [createSuccessEmbed("**" + targetUser.tag + "**'s application has been accepted." + (dmSent ? " DM sent." : " (DM failed.)"))]
            });
        }

        // ---------- PROMOTE (PREFIX) ----------
        if (command === "promote") {
            if (!isStaff(message.member)) {
                return message.reply({ embeds: [createErrorEmbed("You do not have permission to promote.")] });
            }

            const userId = args[0];
            const rank = args[1];
            const notes = args.slice(2).join(" ") || null;

            if (!userId || !rank) {
                return message.reply({ embeds: [createErrorEmbed("Usage: `" + prefix + "promote <userId> <rank> [notes]`")] });
            }

            const targetUser = await client.users.fetch(userId).catch(() => null);
            if (!targetUser) return message.reply({ embeds: [createErrorEmbed("Could not find user with that ID.")] });

            let dmSent = false;
            try {
                await targetUser.send({ embeds: [buildPromotionDM(guild, rank, notes)] });
                dmSent = true;
            } catch (e) { console.error(e); }

            const logEmbed = new EmbedBuilder()
                .setTitle("Promotion")
                .setColor(0x57F287)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "New Rank", value: rank, inline: true },
                    { name: "Promoted By", value: message.author.tag, inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No", inline: true }
                )
                .setTimestamp();

            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024), inline: false });

            await sendHRLog(guild, logEmbed);
            await sendLog(guild, logEmbed);

            return message.reply({ embeds: [createSuccessEmbed("**" + targetUser.tag + "** has been promoted to **" + rank + "**.")] });
        }

        // ---------- DEMOTE (PREFIX) ----------
        if (command === "demote") {
            if (!isStaff(message.member)) {
                return message.reply({ embeds: [createErrorEmbed("You do not have permission to demote.")] });
            }

            const userId = args[0];
            const rank = args[1];
            const notes = args.slice(2).join(" ") || null;

            if (!userId || !rank) {
                return message.reply({ embeds: [createErrorEmbed("Usage: `" + prefix + "demote <userId> <rank> [notes]`")] });
            }

            const targetUser = await client.users.fetch(userId).catch(() => null);
            if (!targetUser) return message.reply({ embeds: [createErrorEmbed("Could not find user with that ID.")] });

            let dmSent = false;
            try {
                await targetUser.send({ embeds: [buildDemotionDM(guild, rank, notes)] });
                dmSent = true;
            } catch (e) { console.error(e); }

            const logEmbed = new EmbedBuilder()
                .setTitle("Demotion")
                .setColor(0xED4245)
                .addFields(
                    { name: "User", value: targetUser.tag + " (" + targetUser.id + ")", inline: false },
                    { name: "New Rank", value: rank, inline: true },
                    { name: "Demoted By", value: message.author.tag, inline: true },
                    { name: "DM Sent", value: dmSent ? "Yes" : "No", inline: true }
                )
                .setTimestamp();

            if (notes) logEmbed.addFields({ name: "Notes", value: notes.slice(0, 1024), inline: false });

            await sendHRLog(guild, logEmbed);
            await sendLog(guild, logEmbed);

            return message.reply({ embeds: [createSuccessEmbed("**" + targetUser.tag + "** has been demoted to **" + rank + "**.")] });
        }

        // ---------- PUNISH (PREFIX) ----------
        if (command === "punish") {
            if (!isStaff(message.member)) {
                return message.reply({ embeds: [createErrorEmbed("You do not have permission to punish.")] });
            }

            const userId = args[0];
            const type = (args[1] || "").toLowerCase();
            const reason = args.slice(2).join(" ");

            const validTypes = ["warn", "strike", "demotion", "suspension"];
            if (!userId || !validTypes.includes(type) || !reason) {
                return message.reply({
                    embeds: [createErrorEmbed("Usage: `" + prefix + "punish <userId> <warn|strike|demotion|suspension> <reason>`")]
                });
            }

            const targetUser = await client.users.fetch(userId).catch(() => null);
            if (!targetUser) return message.reply({ embeds: [createErrorEmbed("Could not find user with that ID.")] });

            const embed = buildPunishEmbed(
                targetUser.tag,
                targetUser.id,
                type,
                reason,
                null,
                message.author.tag
            );

            await sendHRLog(guild, embed);
            await sendLog(guild, embed);

            return message.reply({
                embeds: [createSuccessEmbed("**" + targetUser.tag + "** has been punished: **" + type + "**.")]
            });
        }

    } catch (error) {
        console.error("Message command error:", error);
        try {
            await message.reply({ embeds: [createErrorEmbed("An error occurred.")] });
        } catch (e) {
            console.error(e);
        }
    }
});

// ==========================================
// WELCOME + MEMBER LOGGING
// ==========================================

client.on("guildMemberAdd", async member => {
    try {
        const guild = member.guild;
        const guildConfig = getGuildConfig(guild.id);

        // ---------- WELCOME MESSAGE (matches image format) ----------
        if (guildConfig.welcomeChannelId) {
            const channel = guild.channels.cache.get(guildConfig.welcomeChannelId);

            if (channel) {
                const memberNumber = guild.memberCount;
                const suffix = getOrdinalSuffix(memberNumber);

                const welcomeText =
                    member.toString() +
                    " Hello, and welcome to **" + guild.name + "**! " +
                    "You are our **" + memberNumber + suffix + "** member, enjoy your stay!";

                // Plain text (exactly like your image) — no embed wrapper
                await channel.send({ content: welcomeText });
            }
        }

        // ---------- LOG ----------
        const accountAge = Math.floor((Date.now() - member.user.createdTimestamp) / 86400000);

        await sendLog(guild, createLogEmbed(
            "Member Joined",
            "**User:** " + member + " (" + member.user.tag + ")\n" +
            "**ID:** " + member.id + "\n" +
            "**Account Created:** <t:" + Math.floor(member.user.createdTimestamp / 1000) + ":R> (" + accountAge + " days ago)\n" +
            "**Member Count:** " + guild.memberCount,
            0x57F287
        ));
    } catch (error) {
        console.error("guildMemberAdd error:", error);
    }
});

client.on("guildMemberRemove", async member => {
    try {
        const roles = member.roles?.cache.filter(r => r.id !== member.guild.id).map(r => r.name).join(", ") || "None";
        const joinedAt = member.joinedTimestamp ? "<t:" + Math.floor(member.joinedTimestamp / 1000) + ":R>" : "Unknown";

        await sendLog(member.guild, createLogEmbed(
            "Member Left",
            "**User:** " + member.user.tag + "\n**ID:** " + member.id + "\n**Joined:** " + joinedAt + "\n**Roles:** " + roles,
            0xED4245
        ));
    } catch (error) {
        console.error("guildMemberRemove error:", error);
    }
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
            if (newMember.communicationDisabledUntilTimestamp) {
                changes.push("**Timed out until:** <t:" + Math.floor(newMember.communicationDisabledUntilTimestamp / 1000) + ":F>");
            } else {
                changes.push("**Timeout removed**");
            }
        }
        if (changes.length === 0) return;

        await sendLog(newMember.guild, createLogEmbed(
            "Member Updated",
            "**User:** " + newMember + " (" + newMember.user.tag + ")\n\n" + changes.join("\n"),
            0xFEE75C
        ));
    } catch (error) {
        console.error("guildMemberUpdate error:", error);
    }
});

// ==========================================
// OTHER LOG EVENTS
// ==========================================

client.on("guildBanAdd", async ban => {
    try {
        await sendLog(ban.guild, createLogEmbed(
            "Member Banned",
            "**User:** " + ban.user.tag + "\n**ID:** " + ban.user.id + "\n**Reason:** " + (ban.reason || "No reason provided"),
            0xED4245
        ));
    } catch (error) { console.error("guildBanAdd error:", error); }
});

client.on("guildBanRemove", async ban => {
    try {
        await sendLog(ban.guild, createLogEmbed(
            "Member Unbanned",
            "**User:** " + ban.user.tag + "\n**ID:** " + ban.user.id,
            0x57F287
        ));
    } catch (error) { console.error("guildBanRemove error:", error); }
});

client.on("messageDelete", async message => {
    try {
        if (!message.guild) return;
        if (message.author?.bot) return;
        await sendLog(message.guild, createLogEmbed(
            "Message Deleted",
            "**Author:** " + (message.author?.tag || "Unknown") + " (" + (message.author?.id || "Unknown") + ")\n" +
            "**Channel:** " + message.channel + "\n" +
            "**Content:** " + (message.content || "*Content unavailable*").slice(0, 1500),
            0xED4245
        ));
    } catch (error) { console.error("messageDelete error:", error); }
});

client.on("messageUpdate", async (oldMessage, newMessage) => {
    try {
        if (!oldMessage.guild) return;
        if (oldMessage.author?.bot) return;
        if (oldMessage.content === newMessage.content) return;
        await sendLog(oldMessage.guild, createLogEmbed(
            "Message Edited",
            "**Author:** " + (oldMessage.author?.tag || "Unknown") + "\n" +
            "**Channel:** " + oldMessage.channel + "\n" +
            "**Jump:** [Click here](" + newMessage.url + ")\n\n" +
            "**Before:** " + (oldMessage.content || "*Unavailable*").slice(0, 800) + "\n" +
            "**After:** " + (newMessage.content || "*Unavailable*").slice(0, 800),
            0xFEE75C
        ));
    } catch (error) { console.error("messageUpdate error:", error); }
});

client.on("roleCreate", async role => {
    try {
        await sendLog(role.guild, createLogEmbed(
            "Role Created",
            "**Role:** " + role + "\n**Name:** " + role.name + "\n**ID:** " + role.id,
            0x57F287
        ));
    } catch (error) { console.error("roleCreate error:", error); }
});

client.on("roleDelete", async role => {
    try {
        await sendLog(role.guild, createLogEmbed(
            "Role Deleted",
            "**Role:** " + role.name + "\n**ID:** " + role.id,
            0xED4245
        ));
    } catch (error) { console.error("roleDelete error:", error); }
});

client.on("roleUpdate", async (oldRole, newRole) => {
    try {
        const changes = [];
        if (oldRole.name !== newRole.name) changes.push("**Name:** " + oldRole.name + " → " + newRole.name);
        if (oldRole.hexColor !== newRole.hexColor) changes.push("**Color:** " + oldRole.hexColor + " → " + newRole.hexColor);
        if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push("**Permissions changed**");
        if (changes.length === 0) return;
        await sendLog(newRole.guild, createLogEmbed("Role Updated", "**Role:** " + newRole + "\n\n" + changes.join("\n"), 0xFEE75C));
    } catch (error) { console.error("roleUpdate error:", error); }
});

client.on("channelCreate", async channel => {
    try {
        if (!channel.guild) return;
        await sendLog(channel.guild, createLogEmbed(
            "Channel Created",
            "**Channel:** " + channel + "\n**Name:** " + channel.name + "\n**ID:** " + channel.id,
            0x57F287
        ));
    } catch (error) { console.error("channelCreate error:", error); }
});

client.on("channelDelete", async channel => {
    try {
        if (!channel.guild) return;
        await sendLog(channel.guild, createLogEmbed(
            "Channel Deleted",
            "**Name:** " + channel.name + "\n**ID:** " + channel.id,
            0xED4245
        ));
    } catch (error) { console.error("channelDelete error:", error); }
});

client.on("channelUpdate", async (oldChannel, newChannel) => {
    try {
        if (!newChannel.guild) return;
        const changes = [];
        if (oldChannel.name !== newChannel.name) changes.push("**Name:** " + oldChannel.name + " → " + newChannel.name);
        if (oldChannel.parentId !== newChannel.parentId) changes.push("**Category changed**");
        if (changes.length === 0) return;
        await sendLog(newChannel.guild, createLogEmbed("Channel Updated", "**Channel:** " + newChannel + "\n\n" + changes.join("\n"), 0xFEE75C));
    } catch (error) { console.error("channelUpdate error:", error); }
});

client.on("inviteCreate", async invite => {
    try {
        await sendLog(invite.guild, createLogEmbed(
            "Invite Created",
            "**Code:** " + invite.code + "\n**Channel:** " + invite.channel + "\n**Inviter:** " + (invite.inviter?.tag || "Unknown"),
            0x57F287
        ));
    } catch (error) { console.error("inviteCreate error:", error); }
});

client.on("inviteDelete", async invite => {
    try {
        await sendLog(invite.guild, createLogEmbed(
            "Invite Deleted",
            "**Code:** " + invite.code + "\n**Channel:** " + invite.channel,
            0xED4245
        ));
    } catch (error) { console.error("inviteDelete error:", error); }
});

client.on("voiceStateUpdate", async (oldState, newState) => {
    try {
        const member = newState.member || oldState.member;
        if (!member) return;
        if (!oldState.channelId && newState.channelId) {
            await sendLog(member.guild, createLogEmbed("Voice Channel Joined", "**User:** " + member + "\n**Channel:** " + newState.channel, 0x57F287));
        } else if (oldState.channelId && !newState.channelId) {
            await sendLog(member.guild, createLogEmbed("Voice Channel Left", "**User:** " + member + "\n**Channel:** " + oldState.channel, 0xED4245));
        } else if (oldState.channelId !== newState.channelId) {
            await sendLog(member.guild, createLogEmbed("Voice Channel Switched", "**User:** " + member + "\n**From:** " + oldState.channel + "\n**To:** " + newState.channel, 0xFEE75C));
        }
    } catch (error) { console.error("voiceStateUpdate error:", error); }
});

client.on("guildUpdate", async (oldGuild, newGuild) => {
    try {
        const changes = [];
        if (oldGuild.name !== newGuild.name) changes.push("**Name:** " + oldGuild.name + " → " + newGuild.name);
        if (oldGuild.icon !== newGuild.icon) changes.push("**Server icon changed**");
        if (changes.length === 0) return;
        await sendLog(newGuild, createLogEmbed("Server Updated", changes.join("\n"), 0xFEE75C));
    } catch (error) { console.error("guildUpdate error:", error); }
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