require('dotenv').config();
const { ShardingManager } = require('discord.js');
const path = require('path');

const manager = new ShardingManager(path.join(__dirname, 'index.js'), {
    token: process.env.DISCORD_TOKEN,
    totalShards: 'auto', // Automatically scales based on guild count
});

manager.on('shardCreate', shard => {
    console.log(`[Sharding] Launched Shard ${shard.id}`);
    
    shard.on('ready', () => {
        console.log(`[Sharding] Shard ${shard.id} ready!`);
    });

    shard.on('disconnect', () => {
        console.log(`[Sharding] Shard ${shard.id} disconnected.`);
    });
});

// Run the manager
manager.spawn().catch(error => {
    console.error('[Sharding] Failed to spawn shards:', error);
});
