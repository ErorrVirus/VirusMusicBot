const { EmbedBuilder } = require('discord.js');

module.exports = {
    buildEmbed: (options) => {
        const embed = new EmbedBuilder()
            .setColor(options.color || '#2b2d31');

        if (options.title) embed.setTitle(options.title);
        if (options.description) embed.setDescription(options.description);
        if (options.thumbnail) embed.setThumbnail(options.thumbnail);
        if (options.image) embed.setImage(options.image);
        if (options.author) embed.setAuthor({ name: options.author.name, iconURL: options.author.iconURL });
        if (options.footer) embed.setFooter({ text: options.footer.text, iconURL: options.footer.iconURL });
        if (options.fields) embed.addFields(options.fields);

        return embed;
    },
    
    errorEmbed: (message) => {
        return new EmbedBuilder()
            .setColor('#ed4245')
            .setDescription(`❌ | ${message}`);
    },

    successEmbed: (message) => {
        return new EmbedBuilder()
            .setColor('#57f287')
            .setDescription(`✅ | ${message}`);
    }
};
