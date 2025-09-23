import { Client, GatewayIntentBits, Collection } from 'discord.js';
import config from './config.json' assert { type: "json" };
import { analyzeMusic } from './messageHandlers/analyzeMusic.js';
import platforms from './commands/platforms.js';
import { syncCommand } from './deploy-commands.js';

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

client.login(process.env.TOKEN);

client.on('clientReady', async () => {
    for (const guild of client.guilds.cache.values()) {
        console.info(`Logged in as ${client.user.tag} in ${guild.name}!`);
        for (const command of commands) {
            client.commands.set(command.data.name, command);
            await syncCommand(client, guild, command);
        }
    }
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
    await analyzeMusic(foundMessage, config);
});