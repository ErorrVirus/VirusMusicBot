const { Client, GatewayIntentBits } = require("discord.js");
const { Connectors, Shoukaku } = require("shoukaku");
require("dotenv").config();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const Nodes = [{
    name: "LocalNode",
    url: "127.0.0.1:2333",
    auth: "youshallnotpass"
}];

client.on("ready", () => {
    console.log("Client ready");
    const shoukaku = new Shoukaku(new Connectors.DiscordJS(client), Nodes);
    
    shoukaku.on("ready", (name) => console.log(`Node ${name} ready`));
    shoukaku.on("error", (name, err) => console.error(`Node ${name} error:`, err));
    shoukaku.on("close", (name, code, reason) => console.log(`Node ${name} closed with ${code} ${reason}`));
    shoukaku.on("disconnect", (name, players, moved) => console.log(`Node ${name} disconnected`));
});

client.login(process.env.DISCORD_TOKEN);
