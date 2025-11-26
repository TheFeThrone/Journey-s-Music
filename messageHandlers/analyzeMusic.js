import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import fetch from 'node-fetch';
import { getServerSettings } from '../database.js';

export async function analyzeMusic(foundMessage, config, serverId) {
    if (foundMessage.author.bot) return;

    const serverSettings = await getServerSettings(serverId)

    // Check if the message contains a link from the config file
    const isMusicLink = Object.keys(serverSettings).some(
        platformKey => serverSettings[platformKey].enabled && foundMessage.content.includes(serverSettings[platformKey].prefix)
    );
    if (!isMusicLink) return;
    try {
	// Find the first valid link in the message content
	const link = foundMessage.content.split(/\s+/).find(word =>
            Object.keys(serverSettings).some(
                platformKey => word.includes(serverSettings[platformKey].prefix)
            )
	);
        if (!link) return;

	const hasSpotifyLink = link.includes(serverSettings.spotify.prefix);
	const hasYouTubeLink = link.includes(serverSettings.youtube.prefix);
        const hasAppleMusicLink = link.includes(serverSettings.appleMusic.prefix);
        const hasAmazonMusicLink = link.includes(serverSettings.amazonMusic.prefix);
        const hasSoundCloudLink = link.includes(serverSettings.soundcloud.prefix);

        // Call the music matching API (e.g., Odesli/Songlink)
        const apiResponse = await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(link)}`);
        const data = await apiResponse.json();

        if (data && data.linksByPlatform) {
	    const platforms = data.linksByPlatform;
            const allButtons = [];

            const allAreYouTube = Object.keys(platforms).every(key => key.toLowerCase().includes('youtube'));
            if (allAreYouTube) return;

            if (!hasSpotifyLink && !hasYouTubeLink && !hasAppleMusicLink && !hasAmazonMusicLink && !hasSoundCloudLink) {
                await foundMessage.channel.send({content: `🎶Frieren hums the Music she hears🎶[.](${platforms.spotify.url})`, flags: 4096});
            }


            const firstEntityKey = Object.keys(data.entitiesByUniqueId)[0];
            const entity = data.entitiesByUniqueId[firstEntityKey];
            const title = entity ? entity.title : 'Unknown Title';
            const artist = entity ? entity.artistName : 'Unknown Artist';

            // Build a list of links for other platforms based on your config file keys
            // Create buttons for other platforms from your config file
            for (const platformKey of Object.keys(serverSettings)) {
                if (platforms[platformKey] && serverSettings[platformKey].enabled) {
                    allButtons.push(
                        new ButtonBuilder()
                        .setLabel(serverSettings[platformKey].name)
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
