import { REST, Routes } from 'discord.js';
import { Client, Guild } from 'discord.js';

/**
 * Compares the local command definition with the one fetched from Discord's API.
 * @param {object} localCommand The raw JSON data from your local command file.
 * @param {object} remoteCommand The command object received from the Discord API.
 * @returns {boolean} True if the commands are considered equal, false otherwise.
 */
function areCommandsEqual(localCommand, remoteCommand) {
    // If the descriptions are different, they are not equal.
    if (localCommand.description !== remoteCommand.description) {
        return false;
    }

    // Check the options (the most complex part)
    const localOptions = localCommand.options?.map(o => ({
        name: o.name,
        description: o.description,
        type: o.type,
        required: o.required || false, // Normalize undefined to false
        choices: o.choices || null,
    })) || [];
    
    const remoteOptions = remoteCommand.options?.map(o => ({
        name: o.name,
        description: o.description,
        type: o.type,
        required: o.required || false, // Normalize undefined to false
        choices: o.choices || null,
    })) || [];

    // A simple but effective way to deep-compare the options arrays
    return JSON.stringify(localOptions) === JSON.stringify(remoteOptions);
}

/**
 * Intelligently registers or updates a single slash command for a specific guild.
 * It fetches existing commands and only performs an API call if the command is new or has changed.
 * @param {Client} client The Discord client instance.
 * @param {Guild} guild The guild to deploy the command to.
 * @param {object} command The local command object to sync.
 */
export async function syncCommand(client, guild, command) {
    if (!client?.user?.id || !guild?.id || !command?.data || !client.token) {
        console.error("syncCommand Error: Invalid parameters provided.");
        return;
    }

    const rest = new REST().setToken(client.token);
    const clientId = client.user.id;
    const localCommandData = command.data.toJSON();

    try {
        // Step 1: Fetch all commands for the current guild
        const remoteCommands = await rest.get(Routes.applicationGuildCommands(clientId, guild.id));

        // Step 2: Find the corresponding remote command
        const existingCommand = remoteCommands.find(c => c.name === localCommandData.name);

        if (!existingCommand) {
            // Step 3a: The command is new, so we create it.
            console.log(`Registering new command "${localCommandData.name}" for guild ${guild.name}...`);
            await rest.post(Routes.applicationGuildCommands(clientId, guild.id), {
                body: localCommandData,
            });
            console.log(`Successfully registered command "${localCommandData.name}".`);
        } else {
            // Step 3b: The command exists, so we compare them.
            if (!areCommandsEqual(localCommandData, existingCommand)) {
                // Step 4a: Differences were found, so we update it.
                console.log(`Changes detected for command "${localCommandData.name}". Updating for guild ${guild.name}...`);
                await rest.patch(Routes.applicationGuildCommand(clientId, guild.id, existingCommand.id), {
                    body: localCommandData,
                });
                console.log(`Successfully updated command "${localCommandData.name}".`);
            } else {
                // Step 4b: No changes, so we do nothing.
                console.log(`Command "${localCommandData.name}" is already up-to-date for guild ${guild.name}.`);
            }
        }
    } catch (error) {
        console.error(`Failed to sync command "${localCommandData.name}" for guild ${guild.name}:`, error);
    }
}
