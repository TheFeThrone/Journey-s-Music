import { Client, GatewayIntentBits, Collection, MessageFlags } from 'discord.js';
import config from './config.json' with { type: "json" };
import { analyzeMusic } from './messageHandlers/analyzeMusic.js';
import platforms from './commands/platforms.js';
import country from './commands/country.js';
import customize, { handleCustomize } from './commands/customize.js';
import 'dotenv/config';
import { syncCommand } from './deploy-commands.js';
import { initializeServerSettings, deleteServerSettings, createTables } from './database.js';
import https from 'https';

const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL;
function startHeartbeat(minutes){
    if (HEALTHCHECK_URL) {
        console.log("Healthcheck_URL found");
        // Ping every <minutes> minutes
        setInterval(() => {
            https.get(HEALTHCHECK_URL).on("error", (err) => {
            console.error("Healthcheck ping failed:", err);
          });
        }, minutes * 60 * 1000); // 10 minutes in milliseconds

        https.get(HEALTHCHECK_URL).on("error", (err) => console.error("Healthcheck ping failed:", err));
    } else {
        console.warn("No Healthcheck_URL found. Checking for heartbeat might be important");
    }
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.MessageContent,
    ],
});
client.commands = new Collection();
const commands = [
    platforms,
    country,
    customize
];

async function changePresence(name, status){
    await client.user.setPresence({
        status: status,
        activities: [{
            type: 4,
            emoji: config.presence_emoji,
            name: name
        }]
    });
}

client.login(process.env.TOKEN).catch(err => {
    console.error("Login failed!", err);
    process.exit(1);
});

client.on('clientReady', async () => {
    await createTables();
    startHeartbeat(10);
    let message = `Logged in as ${client.user.tag} in:\n`
    for (const guild of client.guilds.cache.values()) {
        await initializeServerSettings(guild.id, guild.name);
        message += `- ${guild.name}\n`;
    }

    await changePresence(config.presence_idle_init, "idle");
    console.info(message.trim());
    for (const command of commands) {
        client.commands.set(command.data.name, command);
    }
    for (const guild of client.guilds.cache.values()) {
        for (const command of commands) {
	        await syncCommand(client, guild, command);
        }
    }
    await changePresence(config.presence_online, "online");
});

client.on("guildCreate", async (guild) => {
    console.info(`Added to ${guild.name}!`);
    await initializeServerSettings(guild.id, guild.name);
    for (const command of commands) {
        client.commands.set(command.data.name, command);
        await syncCommand(client, guild, command);
    }
});

client.on("guildDelete", async (guild) => {
    console.info(`Removed from ${guild.name}. Deleting settings.`);
    await deleteServerSettings(guild.id);
});

client.on('interactionCreate', async interaction => {
    if(interaction.isCommand && !interaction.isModalSubmit()){
        const command = client.commands.get(interaction.commandName);
        if (!command) {
            console.error(`No command matching ${interaction.commandName} was found.`);
            return;
        }

        try {
            await command.execute(interaction);
        } catch (error) {
            console.error(error);
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            } else {
                await interaction.reply({ content: 'There was an error while executing this command!', flags: MessageFlags.Ephemeral });
            }
        }
    }
    else if(interaction.isModalSubmit()){
        const modalId = interaction.customId;
        await interaction.deferReply({ flags: MessageFlags.Ephemeral});
        if (modalId === "customize_modal") {
            await handleCustomize(interaction);
        }
    }
});

client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guildId) return;
    await changePresence(config.presence_idle_analyzing, "idle");
    await analyzeMusic(message, message.guildId);
    await changePresence(config.presence_online, "online");
});
