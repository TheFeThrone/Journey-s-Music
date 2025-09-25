import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import fetch from 'node-fetch';

export async function analyzeMusic(foundMessage, config) {
    if (foundMessage.author.bot) return;
    // Check if the message contains a link from the config file
    const isMusicLink = Object.values(config.platform).some(
        platform => foundMessage.content.includes(platform.prefix)
    );
    if (isMusicLink) {
        try {
            // Find the first valid link in the message content
            const link = foundMessage.content.split(/\s+/).find(word =>
                Object.values(config.platform).some(platform => word.includes(platform.prefix))
            );
            if (!link) return;
            const hasSpotifyLink = link.includes(config.platform.spotify.prefix);
            const hasYouTubeLink = link.includes(config.platform.youtube.prefix);
            // Call the music matching API (e.g., Odesli/Songlink)
            const apiResponse = await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(link)}`);
            const data = await apiResponse.json();

            if (data && data.linksByPlatform) {
                const platforms = data.linksByPlatform;
                const allButtons = [];

                if (!hasSpotifyLink && !hasYouTubeLink) {
                    await foundMessage.channel.send({content: `🎶Frieren hums the Musik she hears🎶[.](${platforms.spotify.url})`, flags: 4096});
                }
                const firstEntityKey = Object.keys(data.entitiesByUniqueId)[0];
                const entity = data.entitiesByUniqueId[firstEntityKey];
                const title = entity ? entity.title : 'Unknown Title';
                const artist = entity ? entity.artistName : 'Unknown Artist';
                
                // Build a list of links for other platforms based on your config file keys
                // Create buttons for other platforms from your config file
                for (const platformKey of Object.keys(config.platform)) {
                    if (platforms[platformKey] && config.platform[platformKey].enabled) {
                        allButtons.push(
                            new ButtonBuilder()
                                .setLabel(config.platform[platformKey].name)
                                .setStyle(ButtonStyle.Link)
                                .setURL(platforms[platformKey].url)
                        );
                    }
                }
                if (allButtons.length > 0) {
                    const actionRows = [];
                    // Batch buttons into rows of up to 5
                    for (let i = 0; i < allButtons.length; i += 5) {
                        const row = new ActionRowBuilder().addComponents(allButtons.slice(i, i + 5));
                        actionRows.push(row);
                    }
                    
                    const attachment = new AttachmentBuilder(config.animation, { name: 'frieren_analysis.gif' });
                    const embed = new EmbedBuilder()
                        .setColor(config.color)
                        .setTitle(`✨Frieren has finished analyzing the song!✨`)
                        .setDescription(`${title} - ${artist}`)
                        .setThumbnail(`attachment://${attachment.name}`)
                        
                    await foundMessage.channel.send({ embeds: [embed], components: actionRows, files: [attachment], flags: 4096 });
                }
            }
        } catch (error) {
            console.error('Error fetching music links:', error);
        }
    }
}
