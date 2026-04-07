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

function tidalSmartApi(link) {
    // get everything after tidal.com/
    const afterDomain = link.split('tidal.com/')[1];
    const paths = afterDomain
        .replace('browse/', '')
        .split('/')
        .filter(part => part !== 'u' && part !== '');
    const fullPaths = paths.join('-');

    return `https://tidal.com/smart-links/${fullPaths}`;
}

async function tidalAPIfetch(link) {
    const apiUrl = tidalSmartApi(link);
    if (!apiUrl) return { error: "Invalid Tidal link structure" };
    const response = await fetch(apiUrl);
    if (!response.ok) {
        return { error: `Tidal API responded with status ${response.status}` };
    }
    const data = await response.json();
    return data;
}

function translateTidalToOdesli(tidalData, originalLink, country) {
    const statusMatch = tidalData.statusMessage?.match(/(track|album|artist)-(\d+)/);
    const sourceId = statusMatch ? statusMatch[2] : 'unknown';
    const sourceType = statusMatch ? (statusMatch[1] === 'album' ? 'album' : 'song') : 'song';

    const mainEntityUniqueId = `TIDAL_${sourceType.toUpperCase()}::${sourceId}`;

    const entitiesByUniqueId = {
        [mainEntityUniqueId]: {
            id: sourceId,
            type: sourceType,
            title: 'Unknown Title',
            artistName: 'Unknown Artist',
            apiProvider: 'tidal',
            platforms: ['tidal']
        }
    };

    const linksByPlatform = {
        tidal: {
            url: originalLink,
            entityUniqueId: mainEntityUniqueId
        }
    };

    const platformMap = {
        'spotify': 'spotify',
        'apple': 'appleMusic',
        'youtubemusic': 'youtubeMusic',
        'amazon': 'amazonMusic',
        'youtube': 'youtube',
        'soundcloud': 'soundcloud',
        'deezer': 'deezer',
        'pandora': 'pandora',
        'napster': 'napster',
        'yandex': 'yandex'
    };

    if (tidalData.links) {
        tidalData.links.forEach(platformData => {
            const odesliKey = platformMap[platformData.storeId];
            if (!odesliKey) return; 

            let finalUrl = platformData.url;
            const safeCountry = (country || 'US').toUpperCase();


            if (platformData.territories && platformData.territories.length > 0) {
                const targetCountry = platformData.territories.find(t => t.countryCode?.toUpperCase() === safeCountry);
                const usCountry = platformData.territories.find(t => t.countryCode?.toUpperCase() === 'US');

                if (targetCountry && targetCountry.webUrl) {
                    finalUrl = targetCountry.webUrl;
                } else if (usCountry && usCountry.webUrl) {
                    finalUrl = usCountry.webUrl;
                }
            }

            const linkedEntityId = `${odesliKey.toUpperCase()}_${sourceType.toUpperCase()}::unknown`;

            linksByPlatform[odesliKey] = {
                url: platformData.url,
                entityUniqueId: linkedEntityId
            };

            entitiesByUniqueId[mainEntityUniqueId].platforms.push(odesliKey);
        });
    }

    return {
        entityUniqueId: mainEntityUniqueId,
        userCountry: country,
        pageUrl: originalLink,
        entitiesByUniqueId,
        linksByPlatform
    };
}

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
        let odesliData = null;
        let tidalTranslatedData = null;
        let songData = null;

        // Fetch from Odesli
        try {
            const res = await odesli.fetch(link, { country: serverPlatforms.country });
            if (!res.error) odesliData = res;
        } catch (e) {
            await devLog(client, e, "Odesli Fetch", serverName);
        }

        // Fetch from Tidal (if original is Tidal, OR if Odesli found a Tidal link)
        let tidalUrl = link.includes('tidal.com') ? link : odesliData?.linksByPlatform?.tidal?.url;
        if (tidalUrl) {
            try {
                const rawTidal = await tidalAPIfetch(tidalUrl);
                if (!rawTidal.error) {
                    tidalTranslatedData = translateTidalToOdesli(rawTidal, tidalUrl, serverPlatforms.country);
                }
            } catch (e) {
                await devLog(client, e, "Tidal Fetch", serverName);
            }
        }

        // Merge the Results
        if (odesliData && tidalTranslatedData) {
            songData = odesliData;

            for (const [platform, linkInfo] of Object.entries(tidalTranslatedData.linksByPlatform)) {
                if (!songData.linksByPlatform[platform]) {
                    songData.linksByPlatform[platform] = linkInfo;

                    const entityId = linkInfo.entityUniqueId;
                    if (tidalTranslatedData.entitiesByUniqueId[entityId]) {
                        songData.entitiesByUniqueId[entityId] = tidalTranslatedData.entitiesByUniqueId[entityId];
                    }
                }
            }
        } else if (odesliData) {
            songData = odesliData;
        } else if (tidalTranslatedData) {
            songData = tidalTranslatedData;
        } else {
            throw new Error("Both Odesli and Tidal API fetches failed or returned empty data.");
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
