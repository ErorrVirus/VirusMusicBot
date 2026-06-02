require("dotenv").config();
const { Client, GatewayIntentBits, Collection } = require("discord.js");
const fs = require("fs");
const path = require("path");
const LavalinkManager = require("./structures/LavalinkManager");
const express = require("express");

// 1. Setup Render Keep-Alive Server
const app = express();
const port = process.env.PORT || 10000;
app.get("/", (req, res) => res.send("VirusMusicPro is running!"));
app.listen(port, () => console.log(`Dummy server listening on port ${port} for Render`));

// 2. Initialize Discord Client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
    ]
});

// 3. Load Commands
client.commands = new Collection();
const commandsPath = path.join(__dirname, "commands");
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith(".js"));

for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ("data" in command && "execute" in command) {
        client.commands.set(command.data.name, command);
    } else {
        console.log(`[WARNING] The command at ${filePath} is missing a required "data" or "execute" property.`);
    }
}

// 4. Client Events
client.once("ready", () => {
    console.log(`Logged in as ${client.user.tag}`);
    // Register slash commands globally (in production) or to a specific guild
    client.application.commands.set(client.commands.map(cmd => cmd.data));
    console.log(`Registered ${client.commands.size} slash commands.`);
});

client.on("interactionCreate", async interaction => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) return;

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
});

// 5. Initialize Lavalink Manager
client.manager = new LavalinkManager(client).manager;

// 6. Login
client.login(process.env.DISCORD_TOKEN);
