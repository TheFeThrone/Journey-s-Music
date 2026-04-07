import { EmbedBuilder, MessageFlags } from 'discord.js';

/**
 * Sends a diagnostic log to the designated Developer Channel.
 * @param {Client} client - The Discord client instance
 * @param {Error|string} error - The error object or message
 * @param {string} context - Where the error happened (e.g., "Heartbeat", "Command: /play")
 * @param {string} serverName - The name of the server (if applicable)
 */
export async function devLog(client, error, context, serverName = "System") {
    const DEV_CHANNEL_ID = process.env.DEV_CHANNEL;

    if (!DEV_CHANNEL_ID) {
        return console.warn("[devLog] No DEV_CHANNEL ID found in environment variables.");
    }

    try {
        const channel = await client.channels.fetch(DEV_CHANNEL_ID);
        if (!channel) return;

        const errorMessage = error instanceof Error ? error.stack : String(error);
        // Discord has a 4096 limit for embed descriptions, 2000 for standard messages
        const truncatedError = errorMessage.length > 1500 
            ? errorMessage.substring(0, 1497) + "..." 
            : errorMessage;

        const embed = new EmbedBuilder()
            .setTitle('🚨 System Diagnostic')
            .setColor(0xED4245) // Red
            .addFields(
                { name: 'Context', value: context, inline: true },
                { name: 'Server', value: serverName, inline: true },
            )
            .setDescription(`\`\`\`js\n${truncatedError}\n\`\`\``)
            .setTimestamp();

        await channel.send({ embeds: [embed] });
    } catch (err) {
        console.error("Critical: devLog failed to send to Discord:", err.message);
    }
    console.error(context, error);
}