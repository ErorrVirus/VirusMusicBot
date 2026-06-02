const db = require('../database/db');

module.exports = {
    checkBlacklist: async (userId, guildId) => {
        const res = await db.query(
            `SELECT * FROM blacklist WHERE entity_id = $1 OR entity_id = $2`,
            [userId, guildId]
        );
        return res.rows.length > 0;
    },

    checkDJ: async (member) => {
        const res = await db.query(
            `SELECT dj_role_id FROM guild_settings WHERE guild_id = $1`,
            [member.guild.id]
        );
        const djRoleId = res.rows[0]?.dj_role_id;
        
        // If no DJ role is set, everyone is a DJ
        if (!djRoleId) return true;

        // Check if member has the DJ role or Administrator
        if (member.permissions.has('Administrator')) return true;
        if (member.roles.cache.has(djRoleId)) return true;

        return false;
    }
};
