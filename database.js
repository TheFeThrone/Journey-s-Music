import pg from "pg";
const { Pool } = pg;

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

const VALID_PLATFORMS = [
    { key: 'spotify', name: 'Spotify', prefix: 'open.spotify', default_enabled: true },
    { key: 'tidal', name: 'Tidal', prefix: 'tidal.com', default_enabled: true },
    { key: 'amazonMusic', name: 'Amazon Music', prefix: 'music.amazon', default_enabled: true },
    { key: 'youtubeMusic', name: 'YouTube Music', prefix: 'music.youtube', default_enabled: true },
    { key: 'youtube', name: 'YouTube', prefix: 'www.youtu', default_enabled: true },
    { key: 'appleMusic', name: 'Apple Music', prefix: 'music.apple', default_enabled: true },
    { key: 'deezer', name: 'Deezer', prefix: 'deezer.com', default_enabled: true },
    { key: 'soundcloud', name: 'SoundCloud', prefix: 'soundcloud.com', default_enabled: false },
    { key: 'anghami', name: 'Anghami', prefix: 'anghami.com', default_enabled: false },
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
                created_at TIMESTAMP DEFAULT NOW()
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

        console.log("Tables created successfully!");
    } catch (err) {
        console.error("Error creating tables:", err);
    }
}

/**
 * Initializes default platform settings for a server.
 */
export async function initializeServerSettings(serverId) {
    try {
	// check if server exists
	await pool.query(
		'INSERT INTO servers (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
                [serverId]
	);

	// check if it was initialized already
        const { rows } = await pool.query(
		'SELECT initialized FROM servers WHERE id = $1',
       		[serverId]
	);

	if (rows[0].initialized) {
            console.log(`Server ${serverId} is already initialized. Skipping.`);
            return;
        }

        // Fetch only platforms with default_enabled = TRUE
        const { rows: platforms } = await pool.query('SELECT id FROM platforms WHERE default_enabled = TRUE');

        if (platforms.length > 0) {
            const insertValues = platforms.map(p => `(${serverId}, ${p.id}, TRUE)`).join(',');
 	    await pool.query(
                `INSERT INTO server_platforms (server_id, platform_id, enabled) VALUES ${insertValues} ON CONFLICT (server_id, platform_id) DO NOTHING`
            );
        }

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

/**
 * Fetch platform settings for a server
 */
export async function getServerSettings(serverId) {
    const query = `
        SELECT p.key_name, p.name, p.prefix, p.default_enabled, sp.enabled
        FROM platforms p
        LEFT JOIN server_platforms sp
        ON sp.platform_id = p.id AND sp.server_id = $1
    `;
    try {
        const result = await pool.query(query, [serverId]);
        const rows = result.rows;

        // Initialize settings if server was never initialized
        const { rows: serverRows } = await pool.query(
            'SELECT initialized FROM servers WHERE id = $1',
            [serverId]
        );
        if (!serverRows[0].initialized) {
            await initializeServerSettings(serverId);
            return getServerSettings(serverId);
        }

        // Transform rows into key -> { name, prefix, default, enabled }
        const settings = {};
        rows.forEach(r => {
            settings[r.key_name] = {
                name: r.name,
                prefix: r.prefix,
                default: r.default_enabled,
                enabled: !!r.enabled // true if exists, false if null
            };
        });

        return settings;
    } catch (error) {
        console.error('Error fetching server settings:', error);
        return null;
    }
}

/**
 * Update a platform setting for a server
 */
export async function updatePlatformSetting(serverId, platformKey, isEnabled) {
    try {
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
            // Insert enabled platform
            await pool.query(
                `INSERT INTO server_platforms (server_id, platform_id, enabled)
                 VALUES ($1, $2, TRUE)
                 ON CONFLICT (server_id, platform_id) DO NOTHING`,
                [serverId, platformId]
            );
            console.log(`Enabled ${platformKey} for server ${serverId}`);
        } else {
            // Remove disabled platform
            await pool.query(
                `DELETE FROM server_platforms
                 WHERE server_id = $1 AND platform_id = $2`,
                [serverId, platformId]
            );
            console.log(`Disabled ${platformKey} for server ${serverId}`);
        }
    } catch (err) {
        console.error("Error updating platform setting:", err);
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

