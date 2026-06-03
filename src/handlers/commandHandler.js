const fs = require('fs');
const path = require('path');
const { REST, Routes } = require('discord.js');
const config = require('../config');

module.exports = async (client) => {
    client.commands = new Map();
    const commandsArray = [];

    const commandsPath = path.join(__dirname, '../commands');
    if (!fs.existsSync(commandsPath)) fs.mkdirSync(commandsPath);

    const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

    for (const file of commandFiles) {
        const command = require(`../commands/${file}`);
        if (command.data && command.execute) {
            client.commands.set(command.data.name, command);
            commandsArray.push(command.data.toJSON());
        }
    }

    const rest = new REST({ version: '10' }).setToken(config.discord.token);

    try {
        console.log(`Started refreshing ${commandsArray.length} application (/) commands.`);
        if (config.discord.guildId) {
            await rest.put(
                Routes.applicationGuildCommands(config.discord.clientId, config.discord.guildId),
                { body: commandsArray },
            );
            console.log(`Successfully reloaded commands for guild ${config.discord.guildId}.`);
        } else {
            await rest.put(
                Routes.applicationCommands(config.discord.clientId),
                { body: commandsArray },
            );
            console.log('Successfully reloaded commands globally.');
        }
    } catch (error) {
        console.error('Error refreshing commands:', error);
    }
};
