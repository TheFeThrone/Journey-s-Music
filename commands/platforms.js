import { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { getPlatformSettings, updatePlatformSetting } from '../database.js';

/**
 * A helper function to generate the embed and button components based on the current config.
 * This keeps the code DRY (Don't Repeat Yourself).
 * @param {object} serverPlatforms The current platform configuration.
 * @param {string} color The current custom color.
 * @returns {{embeds: EmbedBuilder[], components: ActionRowBuilder[]}}
 */
const generateComponents = (serverPlatforms, color) => {
    const statusEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle('🛠 Config 🛠')
        .setDescription('Configure which platforms should be shown after analysis. Click a button below to toggle the status for that platform.')
        .setFooter({ text: 'Interaction ends in 5 minutes'});

    const platformEntries = Object.entries(serverPlatforms);
    const platformListString = platformEntries
        .map(([key, platform]) => `${platform.enabled ? '✅' : '❌'} ${platform.name}`)
        .join('\n');

    // Add the list as a single field to the embed.
    statusEmbed.addFields({ name: 'All Platforms', value: platformListString });

    const components = [];
    for (let i = 0; i < platformEntries.length; i += 5) {
        const row = new ActionRowBuilder();
        const chunk = platformEntries.slice(i, i + 5);

        chunk.forEach(([key, platform]) => {
            row.addComponents(
                new ButtonBuilder()
                    .setCustomId(`toggle_${key}`)
                    .setLabel(platform.name)
                    .setStyle(platform.enabled ? ButtonStyle.Success : ButtonStyle.Danger)
            );
        });
        components.push(row);
    }

    // Add a final row for the 'Done' button
    const finalRow = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId('done_editing')
            .setLabel('Done')
            .setStyle(ButtonStyle.Primary)
    );
    components.push(finalRow);


    return { embeds: [statusEmbed], components };
};

export default {
    data: new SlashCommandBuilder()
        .setName('platforms')
        .setDescription('Configure which platforms should be shown after analysis.'),

    async execute(interaction) {
        const serverId = interaction.guildId;
        let serverPlatforms = await getPlatformSettings(serverId);
        let serverCustoms = await getPlatformSettings(serverId);

        const message = await interaction.reply({
            ...generateComponents(serverPlatforms, serverCustoms.color),
            flags: MessageFlags.Ephemeral,
            fetchReply: true,
        });

        const collector = message.createMessageComponentCollector({
            componentType: ComponentType.Button,
            time: 300000,
        });

        collector.on('collect', async buttonInteraction => {
            // If the user clicks "Done", we stop the collector.
            if (buttonInteraction.customId === 'done_editing') {
                collector.stop();
                return;
            }

            const platformKey = buttonInteraction.customId.split('_')[1];
	        if (!serverPlatforms[platformKey]) return;

            const newEnabled = !serverPlatforms[platformKey].enabled;

            // Update the database
            await updatePlatformSetting(serverId, platformKey, newEnabled);

            // Update local state
            serverPlatforms[platformKey].enabled = newEnabled;

            // Update the message
            await buttonInteraction.update(generateComponents(serverPlatforms, serverCustoms.color));

        });

        // When the collector ends (by timeout or by clicking "Done")
        collector.on('end', async () => {
            // Create a final, static embed showing the confirmed state.
            const finalEmbed = new EmbedBuilder()
                .setColor(serverCustoms.color)
                .setTitle('🛠 Config 🛠')
                .setDescription('The following configs have been saved.');

	        const platformListString = Object.values(serverPlatforms)
                .map(p => `${p.enabled ? '✅' : '❌'} ${p.name}`)
                .join('\n');

	        // Add the list as a single field to the embed.
            finalEmbed.addFields({ name: 'All Platforms', value: platformListString });

            // Edit the reply to show the final embed and remove all buttons.
            await interaction.editReply({ embeds: [finalEmbed], components: [] });
        });
    },
};

