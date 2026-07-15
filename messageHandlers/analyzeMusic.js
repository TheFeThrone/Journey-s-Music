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

async function fetchOdesli(url, country, client, serverName) {
    try {
        const res = await odesli.fetch(url, { country: country });
        if (!res.error) return res;
    } catch (e) {
        await devLog(client, e, `Odesli Fetch URL: ${url}`, serverName);
    }

    return null;
}

function mergeOdesli(base, extra) {

    if (!base) return extra;
    if (!extra || !extra?.linksByPlatform) return base;

    base.entitiesByUniqueId ??= {};
    base.linksByPlatform ??= {};

    for (const [id, entity] of Object.entries(extra.entitiesByUniqueId ?? {})) {
        const existing = base.entitiesByUniqueId?.[id];

        if (!existing) {
            base.entitiesByUniqueId[id] = entity;
            continue;
        }

        if (
            existing.title === "Unknown Title" &&
            entity.title !== "Unknown Title"
        ) {
            existing.title = entity.title;
        }
        if (
            existing.artistName === "Unknown Artist" &&
            entity.artistName !== "Unknown Artist"
        ) {
            existing.artistName = entity.artistName;
        }
    }

    for (const [platform, linkInfo] of Object.entries(extra.linksByPlatform)) {
        if (!base.linksByPlatform[platform]) {
            base.linksByPlatform[platform] = linkInfo;

            const entityId = linkInfo.entityUniqueId;

            if (extra.entitiesByUniqueId?.[entityId]) {
                base.entitiesByUniqueId[entityId] =
                    extra.entitiesByUniqueId[entityId];
            }
        }
    }
    
    return base;

}

async function fetchTidal(url, country, client, serverName){
    try {
        const rawTidal = await tidalAPIfetch(url);
        if (!rawTidal.error) {
            return translateTidalToOdesli(rawTidal, url, country);
        }
    } catch (e) {
        await devLog(client, e, "Tidal Fetch", serverName);
    }

    return null;
}

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

            linksByPlatform[odesliKey] = {
                url: finalUrl,
                entityUniqueId: mainEntityUniqueId
            };

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
    const checkedUrls = new Set();

    const link = foundMessage.content.split(/\s+/).find(word =>
        Object.values(serverPlatforms).some(
            platform => platform.enabled &&
            word.includes(platform.prefix))
    );
    if (!link) return;
    const cleanLink = link.split("?")[0]; // remove sharing parameters etc

    try {
        let tidalTranslatedData = null;
        let songData = null;


        // Fetch from Odesli
        songData = await fetchOdesli(cleanLink, serverPlatforms.country, client, serverName);
        if (songData) {
            checkedUrls.add(cleanLink);
        }

        // Fetch from Tidal (if original is Tidal, OR if Odesli found a Tidal link)
        let tidalUrl = cleanLink.includes('tidal.com') ? cleanLink : songData?.linksByPlatform?.tidal?.url;
        if (tidalUrl) {
            tidalTranslatedData  = await fetchTidal(tidalUrl, serverPlatforms.country, client, serverName);
        }

        // 
        if ( tidalTranslatedData ) {
            if (!songData) {
                songData = tidalTranslatedData;
            } else {
                songData = mergeOdesli(songData, tidalTranslatedData);
            }

            for (const platform of Object.values(tidalTranslatedData.linksByPlatform)) {
                if (!platform.url || platform.url.includes("tidal.com")) {
                    continue;
                }
                if (checkedUrls.has(platform.url)) {
                    continue;
                }

                const extraOdesli = await fetchOdesli(platform.url, serverPlatforms.country, client, serverName);
                checkedUrls.add(platform.url);

                songData = mergeOdesli(songData, extraOdesli);
            }
        }

        if (!songData?.linksByPlatform) return;
        const platforms = songData.linksByPlatform;

        // Prevent duplicate YouTube embeds
        const isOriginalLinkYouTube = cleanLink.includes(serverPlatforms.youtube?.prefix)
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
        const entities = Object.values(songData.entitiesByUniqueId ?? {});
        const entity = entities.find(
            e => e.title !== "Unknown Title"
        ) ?? entities[0];

        const title = entity ? entity.title : 'Unknown Title';
        const artist = entity ? entity.artistName : 'Unknown Artist';

        // Create buttons for other platforms from server config
        const allButtons = Object.keys(serverPlatforms)
            .filter( platformKey => 
                platforms[platformKey] &&
                platforms[platformKey].url &&
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
