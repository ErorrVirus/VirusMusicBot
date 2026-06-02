const { Connectors } = require("shoukaku");
const { Kazagumo, Plugins } = require("kazagumo");
class LavalinkManager {
    constructor(client) {
        this.client = client;

        const Nodes = [{
            // name: "LocalNode",
            // url: `${process.env.LAVALINK_HOST || "127.0.0.1"}:${process.env.LAVALINK_PORT || "2333"}`,
            // auth: process.env.LAVALINK_PASSWORD || "youshallnotpass",
            // secure: false
        // }, {
            name: "PublicNode",
            url: "node.sibragame.com:2333",
            auth: "sibragame.com",
            secure: false
        }];

        const plugins = [new Plugins.PlayerMoved(client)];

        const shoukakuOptions = {
            moveOnDisconnect: false,
            resumable: false,
            resumableTimeout: 30,
            reconnectTries: 20,
            restTimeout: 60000
        };

        this.manager = new Kazagumo({
            defaultSearchEngine: "youtube",
            plugins: plugins,
            send: (guildId, payload) => {
                const guild = client.guilds.cache.get(guildId);
                if (guild) guild.shard.send(payload);
            }
        }, new Connectors.DiscordJS(client), Nodes, shoukakuOptions);

        this.manager.shoukaku.on("ready", (name) => console.log(`Lavalink Node: ${name} is now connected`));
        this.manager.shoukaku.on("error", (name, error) => console.error(`Lavalink Node: ${name} threw an error:`, error));
        this.manager.shoukaku.on("close", (name, code, reason) => console.log(`Lavalink Node: ${name} closed with code ${code}. Reason: ${reason || "No reason"}`));
        this.manager.shoukaku.on("disconnect", (name, count) => console.log(`Lavalink Node: ${name} disconnected. Reconnect attempts: ${count}`));

        this.manager.on("playerStart", (player, track) => {
            const channel = client.channels.cache.get(player.textId);
            if (channel) {
                channel.send(`🎵 Now playing: **${track.title}** by **${track.author}**`);
            }
        });

        this.manager.on("playerEmpty", player => {
            const channel = client.channels.cache.get(player.textId);
            if (channel) {
                channel.send(`Queue ended. Disconnecting...`);
            }
            player.destroy();
        });
    }
}

module.exports = LavalinkManager;
