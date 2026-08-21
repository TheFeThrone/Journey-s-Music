import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, MessageFlags } from 'discord.js';
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

async function fetchSongLink(url, country, client, serverName) {
    try {
        const targetCountry = country || 'US';

        const response = await fetch(`https://song.link/${encodeURIComponent(url)}`, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept-Language': `${country},en;q=0.9`
            }
        });

        if (!response.ok) return null;

        const html = await response.text();
        const nextDataMatch = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
        if (!nextDataMatch) return null;

        const nextData = JSON.parse(nextDataMatch[1]);
        const pageData = nextData?.props?.pageProps?.pageData;
        if (!pageData) return null;

        const entity = pageData.entityData || {};
        const entityUniqueId = pageData.entityUniqueId || `${entity.provider || 'unknown'}|${entity.type || 'song'}|${entity.id || 'unknown'}`;

        const linksByPlatform = {};
        for (const section of pageData.sections || []) {
            if (!section.links) continue;
            for (const linkItem of section.links) {
                if (linkItem.url && linkItem.platform) {
                    linksByPlatform[linkItem.platform] = {
                        url: linkItem.url,
                        entityUniqueId: linkItem.uniqueId || entityUniqueId,
                        nativeAppUriDesktop: linkItem.nativeAppUriDesktop,
                        nativeAppUriMobile: linkItem.nativeAppUriMobile
                    };
                }
            }
        }

        return {
            entityUniqueId,
            userCountry: country || 'US',
            pageUrl: pageData.pageUrl || `https://song.link/${url}`,
            entitiesByUniqueId: {
                [entityUniqueId]: {
                    id: entity.id || 'unknown',
                    type: entity.type || 'song',
                    title: entity.title || 'Unknown Title',
                    artistName: entity.artistName || 'Unknown Artist',
                    thumbnailUrl: entity.thumbnailUrl || null,
                    thumbnailWidth: entity.thumbnailWidth || null,
                    thumbnailHeight: entity.thumbnailHeight || null,
                    apiProvider: entity.provider || 'unknown',
                    platforms: Object.keys(linksByPlatform)
                }
            },
            linksByPlatform
        };
    } catch (e) {
        await devLog(client, e, `Songlink HTML Scrape URL: ${url}`, serverName);
        return null;
    }
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

const keepParameters = {
    spotify: [],
    tidal: [],
    amazonMusic: [],
    youtubeMusic: ['v'],
    youtube: ['v', 'list'],
    appleMusic: ['i'],
    deezer: [],
    soundcloud: [],
    anghami: [],
    audiomack: [],
    pandora: [],
    yandex: [],
};

function matchesPlatform(hostname, prefix) {
    if (prefix === "youtu") {
        return hostname.includes(prefix);
    }
    return hostname === prefix || hostname.startsWith(`${prefix}`) || hostname.startsWith(`play.${prefix}`) || hostname.endsWith(`${prefix}`);}

function tryParseUrl(link) {
    try {
        return new URL(/^https?:\/\//i.test(link) ? link : `https://${link}`);
    } catch {
        return null;
    }
}

export async function analyzeMusic(client, foundMessage) {
    if (foundMessage.author.bot) return;

    const serverId = foundMessage.guildId;
    const serverName = client.guilds.cache.get(serverId)?.name || null;
    const serverPlatforms = await getPlatformSettings(serverId, serverName);
    const checkedUrls = new Set();

    const link = foundMessage.content.split(/\s+/).map(word =>  word.replace(/^<|>$/g, '').replace(/[.,!?)]*$/, ''))
        .find(word => {
            const url = tryParseUrl(word);
            return url && Object.values(serverPlatforms).some(
                platform =>
                    platform.enabled &&
                    matchesPlatform(url.hostname, platform.prefix)
            );
        }
    );

    if (!link) return;

    const url = tryParseUrl(link);
    if (!url) return;

    const platform = Object.values(serverPlatforms).find(
        platform => platform.enabled &&
        matchesPlatform(url.hostname, platform.prefix)
    );

    const keep = keepParameters[platform?.key] ?? [];
    for (const param of [...url.searchParams.keys()]) {
        if (!keep.includes(param)) {
            url.searchParams.delete(param);
        }
    }

    const cleanLink = url.toString();

    try {
        let tidalTranslatedData = null;
        let songData = null;


        // Fetch from Odesli
        // songData = await fetchOdesli(cleanLink, serverPlatforms.country, client, serverName);
        songData = await fetchSongLink(cleanLink, serverPlatforms.country, client, serverName);
        if (songData) {
            checkedUrls.add(cleanLink);
        }

        // Fetch from Tidal (if original is Tidal, OR if Odesli found a Tidal link)
        let tidalUrl = cleanLink.includes('tidal.com') ? cleanLink : songData?.linksByPlatform?.tidal?.url;
        if (tidalUrl) {
            tidalTranslatedData  = await fetchTidal(tidalUrl, serverPlatforms.country, client, serverName);
        }

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

                // const extraOdesli = await fetchOdesli(platform.url, serverPlatforms.country, client, serverName);
                const extraOdesli = await fetchSongLink(platform.url, serverPlatforms.country, client, serverName);
                checkedUrls.add(platform.url);

                songData = mergeOdesli(songData, extraOdesli);
            }
        }

        if (!songData?.linksByPlatform) {
            await devLog(client, link, "songData missing linksByPlatform", serverName)
            return;
	}
        const platforms = songData.linksByPlatform;

        // Find the first ethically available embedded audio link
        const embeddedLink = platforms.soundcloud?.url 
            || platforms.youtube?.url 
            || platforms.spotify?.url 
            || platforms.appleMusic?.url 
            || platforms.amazonMusic?.url 
            || false;

        const serverCustoms = await getCustomSettings(serverId, serverName);

        const isOriginalLinkYouTube = platform?.key === 'youtube' || platform?.key === 'youtubeMusic';
        if (!isOriginalLinkYouTube) {
            await foundMessage.suppressEmbeds(true).catch(() => {});
        }

        const allAreYouTube = Object.keys(platforms).every(
            key => key.toLowerCase().includes('youtube'));

        // Send Search Embed and hidden link to embed audio visualizer
        if ( allAreYouTube && isOriginalLinkYouTube ) {
            return;
        }
        if (embeddedLink) {
            const searchEmbed = new EmbedBuilder()
                .setColor(serverCustoms.color)
                .setTitle(serverCustoms.embed_search)
            await foundMessage.channel.send({ embeds: [searchEmbed], flags: MessageFlags.SuppressNotifications });
            if (!isOriginalLinkYouTube) {
                await foundMessage.channel.send({content: `[    ♪♫♪](${embeddedLink})`, flags: MessageFlags.SuppressNotifications });
            }
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
            .setDescription(`\n**${title} - ${artist}**\n`)
            .setThumbnail(thumbnailUrl)

        await foundMessage.channel.send({
            embeds: [finalEmbed],
            components: actionRows,
            files: [attachment].filter(Boolean),
            flags: MessageFlags.SuppressNotifications
        });

    } catch (error) {
        await devLog(client, error, "Work on Link", serverName);
    }
}
