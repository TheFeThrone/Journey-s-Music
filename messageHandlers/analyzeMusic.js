import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder } from 'discord.js';
import config from '../config.json' with { type: "json" };
import fetch from 'node-fetch';
import { getPlatformSettings, getCustomSettings } from '../database.js';
import { devLog } from '../dev.js';
import Odesli from 'odesli.js';

const odesli = new Odesli({
    version: 'v1-alpha.1',
    cache: true,      // Automatically prevents 429 errors for repeat links
    maxRetries: 3,    // Auto-retries if it fails
    retryDelay: 1500,
    headers: { 'User-Agent': 'JourneyMusicBot/1.0' },
    validateParams: true
});

export async function analyzeMusic(client, foundMessage) {
    if (foundMessage.author.bot) return;
    const serverId = foundMessage.guildId;
    const serverName = client.guilds.cache.get(serverId)?.name || null;
    const serverPlatforms = await getPlatformSettings(serverId, serverName);

    const link = foundMessage.content.split(/\s+/).find(word =>
        Object.values(serverPlatforms).some(
            platform => platform.enabled &&
            word.includes(platform.prefix))
    );
    if (!link) return;

    try {
        let songData;
        try {
            songData = await odesli.fetch(link, {
                country: serverPlatforms.country
            });
            if (songData.error) {
                throw new Error(songData.error);
            }
        } catch (error) {
            await devLog(client, error, "Odesli Library Fetch", serverName);
            return;
        }
        if (!songData?.linksByPlatform) return;
        const platforms = songData.linksByPlatform;

        // Prevent duplicate YouTube embeds
        const isOriginalLinkYouTube = link.includes(serverPlatforms.youtube?.prefix)
        const allAreYouTube = Object.keys(platforms).every(
            key => key.toLowerCase().includes('youtube'));
        if (isOriginalLinkYouTube && allAreYouTube) return;

        // Find the first ethically available embedded audio link
        const embeddedLink = platforms.soundcloud?.url 
            || platforms.youtube?.url 
            || platforms.spotify?.url 
            || platforms.appleMusic?.url 
            || platforms.amazonMusic?.url 
            || false;

        const serverCustoms = await getCustomSettings(serverId, serverName);
        await foundMessage.suppressEmbeds(true);

        // Send Search Embed and hidden link to embed audio visualizer
        if (embeddedLink) {
            const searchEmbed = new EmbedBuilder()
                .setColor(serverCustoms.color)
                .setTitle(serverCustoms.embed_search)
            await foundMessage.channel.send({ embeds: [searchEmbed], flags: 4096 });
            await foundMessage.channel.send({content: `[    ♪♫♪](${embeddedLink})`, flags: 4096 });
        }

        // Extract Song Info
        const entity = Object.values(songData.entitiesByUniqueId)[0];
        const title = entity ? entity.title : 'Unknown Title';
        const artist = entity ? entity.artistName : 'Unknown Artist';

        // Create buttons for other platforms from server config
        const allButtons = Object.keys(serverPlatforms)
            .filter( platformKey => 
                platforms[platformKey] &&
                serverPlatforms[platformKey].enabled
            )
            .map( key =>
                new ButtonBuilder()
                    .setLabel(serverPlatforms[key].name)
                    .setStyle(ButtonStyle.Link)
                    .setURL(platforms[key].url)
            );
        if (allButtons.length === 0) return;

        // Batch buttons into rows of up to 5
        const actionRows = [];
        for (let i = 0; i < allButtons.length; i += 5) {
            actionRows.push(
                new ActionRowBuilder().addComponents(allButtons.slice(i, i + 5))
            );
        }

        // Build and Send the Final Embed
        const attachment = !serverCustoms.animation ? new AttachmentBuilder(config.animation) : null;
        const thumbnailUrl = serverCustoms.animation ? serverCustoms.animation : `attachment://${config.animation}`;

        const finalEmbed = new EmbedBuilder()
            .setColor(serverCustoms.color)
            .setTitle(serverCustoms.embed_final)
            .setDescription(`${title} - ${artist}`)
            .setThumbnail(thumbnailUrl)

        await foundMessage.channel.send({
            embeds: [finalEmbed],
            components: actionRows,
            files: [attachment].filter(Boolean),
            flags: 4096
        });

    } catch (error) {
        await devLog(client, error, "Work on Link", serverName);
    }
}
