import { Client, GatewayIntentBits, Collection } from 'discord.js';
import config from './config.json' assert { type: "json" };
import { analyzeMusic } from './messageHandlers/analyzeMusic.js';
import platforms from './commands/platforms.js';
import { syncCommand } from './deploy-commands.js';
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
        console.warn("No Healthcheck_URL found. Checking for heartbeat might be impoortant");
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
    platforms
];

async function changePresence(name, status){
    await client.user.setPresence({
        status: status,
	activities: [{
            type: 4,
            emoji: '<:frieren_heart_pink:1242819328194117775>',
            name: name
	}]
    });
}

client.login(process.env.TOKEN).catch(err => {
    console.error("Login failed!", err);
    proccess.exit(1);
});

client.on('ready', async () => {
    startHeartbeat(10);
    let message = `Logged in as ${client.user.tag} in:\n`
    for (const guild of client.guilds.cache.values()) {
        message += `- ${guild.name}\n`;
    }
    await changePresence("Getting ready for the Journey","idle");
    console.info(message.trim());
    for (const guild of client.guilds.cache.values()) {
        for (const command of commands) {
            client.commands.set(command.data.name, command);
	    await syncCommand(client, guild, command);
        }
    }
    await changePresence("Being an innocent elf on a Journey", "online");
});

client.on("guildCreate", async () => {
    for (const guild of client.guilds.cache.values()) {
        console.info(`Added to ${client.user.tag} in ${guild.name}!`);
        for (const command of commands) {
            client.commands.set(command.data.name, command);
            await syncCommand(client, guild, command);
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const command = client.commands.get(interaction.commandName);
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found.`);
        return;
    }

    try {
        await command.execute(interaction, config);
    } catch (error) {
        console.error(error);
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: 'There was an error while executing this command!', ephemeral: true });
        } else {
            await interaction.reply({ content: 'There was an error while executing this command!', ephemeral: true });
        }
    }
});

client.on('messageCreate', async (foundMessage) => {
    await changePresence("Analyzing music heard on the Journey", "idle");
    await analyzeMusic(foundMessage, config);
    await changePresence("Being an innocent elf on a Journey", "online");
});
