require("dotenv").config();
const { Client, GatewayIntentBits, Collection } = require("discord.js");
const fs = require("fs");
const path = require("path");
const LavalinkManager = require("./structures/LavalinkManager");
const express = require("express");
const db = require("./database/db");
const redisClient = require("./cache/redis");

// 1. Setup Healthcheck & Web Server (Pro Version)
const app = express();
const port = process.env.PORT || 3000;

app.get("/", (req, res) => res.send("VirusMusicPro Shard is running!"));
app.get("/health", (req, res) => res.status(200).send("OK"));

const server = app.listen(port, () => {
    console.log(`[HTTP] Health server listening on port ${port}`);
}).on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`[ERROR] Port ${port} is already in use.`);
    }
});

// 2. Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// Attach DB to client for easy access
client.db = db;
client.redis = redisClient;

// 3. Load Commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
    }
}

// 4. Client Events
client.once("ready", async () => {
    // Initialize DB tables
    try {
        await db.init();
    } catch(e) {
        console.error('[Database] Failed to initialize schema:', e);
    }

    console.log(`Logged in as ${client.user.tag}`);
    client.application.commands.set(client.commands.map(cmd => cmd.data));
    console.log(`Registered ${client.commands.size} slash commands.`);
});

client.on("interactionCreate", async interaction => {
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        // Initialize Guild in DB
        await db.initGuild(interaction.guildId);

        try {
            await command.execute(interaction, client);
        } catch (error) {
            console.error(error);
            const reply = { content: 'There was an error while executing this command!', ephemeral: true };
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp(reply);
            } else {
                await interaction.reply(reply);
            }
        }
    } else if (interaction.isButton()) {
        // Handle Now Playing UI buttons
        const player = client.manager.players.get(interaction.guildId);
        if (!player) {
            return interaction.reply({ content: 'No music is currently playing!', ephemeral: true });
        }

        try {
            await interaction.deferUpdate();
            if (interaction.customId === 'btn_pause') {
                player.pause(!player.paused);
            } else if (interaction.customId === 'btn_skip') {
                player.skip();
            } else if (interaction.customId === 'btn_stop') {
                player.destroy();
            } else if (interaction.customId === 'btn_loop') {
                if (player.loop === 'none') player.setLoop('track');
                else if (player.loop === 'track') player.setLoop('queue');
                else player.setLoop('none');
            }
        } catch(e) {
            console.error('[Button Error]', e);
        }
    }
});

// 5. Initialize Lavalink Manager (Must be BEFORE client.login)
client.manager = new LavalinkManager(client).manager;

// 6. Login
client.login(process.env.DISCORD_TOKEN);
