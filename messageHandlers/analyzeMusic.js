import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import config from '../config.json' assert  { type: "json" };
import fetch from 'node-fetch';
import { getPlatformSettings, getCustomSettings } from '../database.js';

export async function analyzeMusic(foundMessage, serverId) {
    if (foundMessage.author.bot) return;

    const serverPlatforms = await getPlatformSettings(serverId);
    const serverCustoms = await getCustomSettings(serverId);

    // Check if the message contains a link from the config file
    const isMusicLink = Object.keys(serverPlatforms).some(
        platformKey => serverPlatforms[platformKey].enabled && foundMessage.content.includes(serverPlatforms[platformKey].prefix)
    );
    if (!isMusicLink) return;

    try {
        // Find the first valid link in the message content
        const link = foundMessage.content.split(/\s+/).find(word =>
            Object.keys(serverPlatforms).some(
                platformKey => word.includes(serverPlatforms[platformKey].prefix)
            )
        );
        if (!link) return;

        // Vars for platforms with already embedded audio
        const hasSpotifyLink = link.includes(serverPlatforms.spotify.prefix);
        const hasYouTubeLink = link.includes(serverPlatforms.youtube.prefix);
        const hasAppleMusicLink = link.includes(serverPlatforms.appleMusic.prefix);
        const hasAmazonMusicLink = link.includes(serverPlatforms.amazonMusic.prefix);
        const hasSoundCloudLink = link.includes(serverPlatforms.soundcloud.prefix);
        const hasEmbed = (hasSpotifyLink || hasYouTubeLink || hasAppleMusicLink || hasAmazonMusicLink || hasSoundCloudLink);

        // TODO: tidal specific api call with https://tidal.com/smart-links/${tidal-path-without-?u}
        // const hasTidalLink = link.includes(serverPlatforms.tidal.prefix);

        // Call the music matching API (e.g., Odesli/Songlink)
        const apiResponse = await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(link)}&userCountry=${serverPlatforms.country}`);
        const data = await apiResponse.json();

        if (data && data.linksByPlatform) {
            const platforms = data.linksByPlatform;
            const allButtons = [];

            const allAreYouTube = Object.keys(platforms).every(key => key.toLowerCase().includes('youtube'));
            if (hasYouTubeLink && allAreYouTube) {
                return;
            }
            const embeddedLink = platforms.soundcloud ? platforms.soundcloud.url :
                               platforms.youtube ? platforms.youtube.url :
                               platforms.spotify ? platforms.spotify.url :
                               platforms.appleMusic ? platforms.appleMusic.url :
                               platforms.amazonMusic ? platforms.amazonMusic.url : false;

            await foundMessage.suppressEmbeds(true);
            if (embeddedLink) {
                const embed = new EmbedBuilder()
                    .setColor(serverCustoms.color)
                    .setTitle(serverCustoms.embed_search)
                await foundMessage.channel.send({ embeds: [embed], flags: 4096 });
                await foundMessage.channel.send({content: `[    ♪♫♪](${embeddedLink})`, flags: 4096 });
            }

            const firstEntityKey = Object.keys(data.entitiesByUniqueId)[0];
            const entity = data.entitiesByUniqueId[firstEntityKey];
            const title = entity ? entity.title : 'Unknown Title';
            const artist = entity ? entity.artistName : 'Unknown Artist';

            // Build a list of links for other platforms based on your config file keys
            // Create buttons for other platforms from your config file
            for (const platformKey of Object.keys(serverPlatforms)) {
                if (platforms[platformKey] && serverPlatforms[platformKey].enabled) {
                    allButtons.push(
                        new ButtonBuilder()
                        .setLabel(serverPlatforms[platformKey].name)
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

                const attachment = !serverCustoms.animation ? new AttachmentBuilder(config.animation) : null;
                const thumbnailUrl = serverCustoms.animation ? serverCustoms.animation : `attachment://${config.animation}`;
                const embed = new EmbedBuilder()
                    .setColor(serverCustoms.color)
                    .setTitle(serverCustoms.embed_final)
                    .setDescription(`${title} - ${artist}`)
                    .setThumbnail(thumbnailUrl)
                await foundMessage.channel.send({ embeds: [embed], components: actionRows, files: [attachment], flags: 4096 });
            }
        }
    } catch (error) {
        console.error('Error:', error);
    }
}
