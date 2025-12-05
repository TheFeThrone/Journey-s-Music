import config from './config.json' with { type: "json" };
import 'dotenv/config';
import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// api source https://linktree.notion.site/API-d0ebe08a5e304a55928405eb682f6741
// could need: napster, spinrilla, audius, boomplay, bandcamp
const VALID_PLATFORMS = [
    { key: 'spotify', name: 'Spotify', prefix: 'open.spotify', default_enabled: true },
    { key: 'tidal', name: 'Tidal', prefix: 'tidal.com', default_enabled: true },
    { key: 'amazonMusic', name: 'Amazon Music', prefix: 'music.amazon', default_enabled: true },
    { key: 'youtubeMusic', name: 'YouTube Music', prefix: 'music.youtube', default_enabled: true },
    { key: 'youtube', name: 'YouTube', prefix: 'www.youtu', default_enabled: true },
    { key: 'appleMusic', name: 'Apple Music', prefix: 'music.apple', default_enabled: true },
    { key: 'deezer', name: 'Deezer', prefix: 'deezer.com', default_enabled: true },
    { key: 'soundcloud', name: 'SoundCloud', prefix: 'soundcloud.com', default_enabled: false },
    { key: 'anghami', name: 'Anghami', prefix: 'anghami.', default_enabled: false },
    { key: 'audiomack', name: 'Audiomack', prefix: 'audiomack.com', default_enabled: false },
    { key: 'pandora', name: 'Pandora', prefix: 'pandora.com', default_enabled: false },
    { key: 'yandex', name: 'Yandex', prefix: 'music.yandex', default_enabled: false },
];

export async function createTables() {
    try {
        // Create platforms table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS platforms (
                id SERIAL PRIMARY KEY,
                key_name TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                prefix TEXT NOT NULL,
                default_enabled BOOLEAN NOT NULL
            );
        `);

        // Insert platforms if not already present
        for (const platform of VALID_PLATFORMS) {
            await pool.query(
                `
                INSERT INTO platforms (key_name, name, prefix, default_enabled)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (key_name) DO NOTHING;
                `,
                [platform.key, platform.name, platform.prefix, platform.default_enabled]
            );
        }

        // Create servers table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS servers (
                id BIGINT PRIMARY KEY,
                name TEXT,
                initialized BOOLEAN NOT NULL DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT NOW(),
                country TEXT DEFAULT 'DE'
            );
        `);

        // Create server_platforms table to save each active platform for a server
        await pool.query(`
            CREATE TABLE IF NOT EXISTS server_platforms (
                server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                platform_id INT NOT NULL REFERENCES platforms(id) ON DELETE CASCADE,
                enabled BOOLEAN NOT NULL DEFAULT TRUE,
                PRIMARY KEY (server_id, platform_id)
            );
        `);

        // Create server_platforms table to save each active platform for a server
        await pool.query(`
            CREATE TABLE IF NOT EXISTS server_customs (
                server_id BIGINT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
                name TEXT NOT NULL DEFAULT '${config.name.replace(/'/g, "''")}',
                color TEXT NOT NULL DEFAULT '${config.color}',
                animation TEXT DEFAULT NULL,
                embed_search TEXT NOT NULL DEFAULT '${config.embed_search.replace(/'/g, "''")}',
                embed_final TEXT NOT NULL DEFAULT '${config.embed_final.replace(/'/g, "''")}',
                PRIMARY KEY (server_id)
            );
        `);

        console.log("Tables created successfully!");
    } catch (err) {
        console.error("Error creating tables:", err);
    }
}

/**
 * Initializes default platform settings for a server.
 */
export async function initializeServerSettings(serverId, serverName) {
    try {
        const { rows } = await pool.query(
            `INSERT INTO servers (id, name)
            VALUES ($1, $2)
            ON CONFLICT (id)
            DO UPDATE SET name = EXCLUDED.name
            RETURNING initialized;`,
            [serverId, serverName]
        );
        
        if (rows[0]?.initialized) {
            console.log(`Server ${serverId} is already initialized. Skipping.`);
            return;
        }

        // Fetch only platforms with default_enabled = TRUE
        const { rows: platforms } = await pool.query(
            'SELECT id FROM platforms WHERE default_enabled = TRUE;'
        );
        if (platforms.length > 0) {
            const insertValues = platforms
                .map(p => `(${serverId}, ${p.id}, TRUE)`)
                .join(',');

            await pool.query(
                `INSERT INTO server_platforms (server_id, platform_id, enabled)
                VALUES ${insertValues}
                ON CONFLICT (server_id, platform_id) DO NOTHING;`
            );
        }

        const nullSettings = {name: null, color: null, animation: null, embed_search: null, embed_final: null};
        await updateCustomSettings(serverId, nullSettings);

        // Mark server as initialized
        await pool.query(
            'UPDATE servers SET initialized = TRUE WHERE id = $1',
            [serverId]
        );

        console.log(`Initialized settings for server: ${serverId}`);
    } catch (error) {
        console.error('Error initializing server settings:', error);
    }
}

async function assureExistence(serverId){
    const { rows: serverRows } = await pool.query(
        'SELECT initialized FROM servers WHERE id = $1',
        [serverId]
    );
    if (!serverRows[0].initialized) {
        await initializeServerSettings(serverId, serverName);
    }
}

/**
 * Fetch platform settings for a server
 */
export async function getPlatformSettings(serverId, serverName) {
    try {
        const settings = {};

        assureExistence(serverId);

        const { rows } = await pool.query(`
            SELECT p.key_name, p.name, p.prefix, p.default_enabled, sp.enabled
            FROM platforms p
            LEFT JOIN server_platforms sp
            ON sp.platform_id = p.id AND sp.server_id = $1;
        `, [serverId]);

        // Transform rows into key -> { name, prefix, default, enabled }
        for (const r of rows) {
            settings[r.key_name] = {
                name: r.name,
                prefix: r.prefix,
                default: r.default_enabled,
                enabled: !!r.enabled
            };
        };

        return settings;
    } catch (error) {
        console.error('Error fetching server settings:', error);
        return null;
    }
}

export async function getCustomSettings(serverId) {
    try {
        const { rows } = await pool.query(
            `SELECT name, color, animation, embed_search, embed_final
             FROM server_customs
             WHERE server_id = $1`,
            [serverId]
        );

        if (rows.length === 0) {
            // If no row exists, return defaults
            return {
                name: config.name,
                color: config.color,
                animation: null,
                embed_search: config.embed_search,
                embed_final: config.embed_final
            };
        }

        return rows[0];
    } catch (err) {
        console.error("Error fetching custom settings:", err);
        return null;
    }
}

export async function updateCustomSettings(serverId, newSettings) {
    let { name, color, animation, embed_search, embed_final } = newSettings;

    if (!name || name.trim() === '') name = config.name;
    if (!color || color.trim() === '') color = config.color;
    if (!embed_search || embed_search.trim() === '') embed_search = config.embed_search;
    if (!embed_final || embed_final.trim() === '') embed_final = config.embed_final;
    
    try {
        await pool.query(
            `INSERT INTO server_customs (server_id, name, color, animation, embed_search, embed_final)
             VALUES ($1, $2, $3, $4, $5, $6)
             ON CONFLICT (server_id)
             DO UPDATE SET 
                name = EXCLUDED.name,
                color = EXCLUDED.color,
                animation = EXCLUDED.animation,
                embed_search = EXCLUDED.embed_search,
                embed_final = EXCLUDED.embed_final`,
            [serverId, name, color, animation, embed_search, embed_final]
        );
        console.log(`Updated custom settings for server ${serverId}`);
    } catch (err) {
        console.error("Error updating custom settings:", err);
    }
}

export async function updateCountrySettings(serverId, countryCode) {
    try {
        
        assureExistence(serverId);

        const update = await pool.query(
            'UPDATE servers SET country = $1 WHERE id = $2;',
            [countryCode, serverId]
        );

        if (updateResult.rowCount === 1) {
            console.log(`Successfully updated country for server ${serverId} to ${countryCode}.`);
        } else {
            console.error(`Update failed for server ${serverId}.`);
        }
    }catch (error) {
        console.error('Database error during country settings update:', error);
    }
}

/**
 * Update a platform setting for a server
 */
export async function updatePlatformSetting(serverId, platformKey, isEnabled) {
    try {
        assureExistence(serverId);

        // Get platform ID
        const { rows } = await pool.query(
            'SELECT id FROM platforms WHERE key_name = $1',
            [platformKey]
        );
        if (rows.length === 0) {
            console.error(`Invalid platform key: ${platformKey}`);
            return;
        }
        const platformId = rows[0].id;

        if (isEnabled) {
            await pool.query(
                `INSERT INTO server_platforms (server_id, platform_id, enabled)
                 VALUES ($1, $2, TRUE)
                 ON CONFLICT (server_id, platform_id) DO NOTHING`,
                [serverId, platformId]
            );
        } else {
            await pool.query(
                `DELETE FROM server_platforms
                 WHERE server_id = $1 AND platform_id = $2`,
                [serverId, platformId]
            );
        }

        console.log(`${isEnabled ? "Enabled" : "Disabled"} ${platformKey} for server ${serverId}`);
    } catch (error) {
        console.error("Error updating platform setting:", error);
    }
}


/**
 * Deletes the settings for a server.
 */
export async function deleteServerSettings(serverId) {
    try {
        await pool.query('DELETE FROM server_platforms WHERE server_id = $1', [serverId]);
        await pool.query('DELETE FROM servers WHERE id = $1', [serverId]);
        console.log(`Deleted settings for server ${serverId}`);
    } catch (err) {
        console.error("Error deleting server settings:", err);
    }
}

