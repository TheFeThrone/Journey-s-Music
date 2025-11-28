import { ActionRowBuilder, EmbedBuilder, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, ButtonStyle, ButtonBuilder, SlashCommandBuilder, ComponentType } from 'discord.js';
import { getServerSettings, updateCountrySettings } from '../database.js';
import COUNTRY_MAP from '../country_map.json' assert { type: 'json' };

const ALPHABET_RANGES = [
    { label: 'AG - BJ', startCode: 'AG', endCode: 'BJ' },
    { label: 'BL - CR', startCode: 'BL', endCode: 'CR' },
    { label: 'CU - FR', startCode: 'CU', endCode: 'FR' },
    { label: 'GA - HU', startCode: 'GA', endCode: 'HU' },
    { label: 'ID - KZ', startCode: 'ID', endCode: 'KZ' },
    { label: 'LA - MQ', startCode: 'LA', endCode: 'MQ' },
    { label: 'MR - PF', startCode: 'MR', endCode: 'PF' },
    { label: 'PG - SI', startCode: 'PG', endCode: 'SI' },
    { label: 'SJ - TR', startCode: 'SJ', endCode: 'TR' },
    { label: 'TT - ZW', startCode: 'TT', endCode: 'ZW' },
];

/**
 * Generates the first selection menu (Code Ranges)
 */
function generateRangeSelect() {
    const selectMenu = new StringSelectMenuBuilder()
        .setCustomId('range_select')
        .setPlaceholder('Select the country code range...');

    ALPHABET_RANGES.forEach(range => {
        selectMenu.addOptions({
            label: range.label,
            value: range.label, // Use the label as the value to identify the chosen range
        });
    });

    return new ActionRowBuilder().addComponents(selectMenu);
}

function generateCountrySelect(rangeLabel) {
    const range = ALPHABET_RANGES.find(r => r.label === rangeLabel);
    if (!range) return null;

    const { startCode, endCode } = range;

    const codes = Object.keys(COUNTRY_MAP.country_data)
        .filter(code => code >= startCode && code <= endCode)
        .sort();

    const menu = new StringSelectMenuBuilder()
        .setCustomId('country_final_select')
        .setPlaceholder(`Select country (${rangeLabel})`);

    codes.forEach(code => {
        menu.addOptions(
            new StringSelectMenuOptionBuilder()
                .setLabel(`${COUNTRY_MAP.country_data[code]} (${code})`)
                .setValue(code)
        );
    });

    return new ActionRowBuilder().addComponents(menu);
}

const generateCountryComponents = (currentCountryCode, color) => {
    // Get the full name for the current country
    const currentCountryName = COUNTRY_MAP.country_data[currentCountryCode] || 'UNKNOWN - Default DE';

    // 1. Create the Status Embed
    const statusEmbed = new EmbedBuilder()
        .setColor(color)
        .setTitle('🌍 Country Configuration ⚙️')
        .setDescription('Select the country code range to view available country settings.')
        .addFields(
            { 
                name: 'Current Setting',
                value: `**${currentCountryCode}**: ${currentCountryName}`, 
                inline: true 
            }
        )
        .setFooter({ text: 'Selection ends in 2 minutes' });

    const rangeSelectRow = generateRangeSelect();
    // 3. Return the payload
    return { 
        embeds: [statusEmbed], 
        components: [rangeSelectRow] 
    };
};

export default {
    data: new SlashCommandBuilder()
        .setName('country')
        .setDescription('Configure the country/location your streaming platforms are restricted to.'),

    async execute(interaction, config) {
        const serverId = interaction.guildId;
        const color = config.color;
        const serverSettings = await getServerSettings(serverId);
        const countryCode = serverSettings.country || "??";
        const countryName = COUNTRY_MAP.country_data[countryCode] || "??";

        const componentPayload = generateCountryComponents(countryCode, color);
        const initialMessage = await interaction.reply({
            ...componentPayload, // Spreads the { embeds, components } object
            ephemeral: true,
            fetchReply: true,
        });

        const collector = initialMessage.createMessageComponentCollector({
            componentType: ComponentType.StringSelect,
            filter: (i) => i.user.id === interaction.user.id,
            time: 120000,
        });

        collector.on('collect', async (i) => {
            await i.deferUpdate();
            const customId = i.customId;

            if (customId === 'range_select') {
                const selectedRangeLabel = i.values[0];
                const countryRow = generateCountrySelect(selectedRangeLabel);

                await i.editReply({
                    content: `Showing countries in the **${selectedRangeLabel}** range. Please select the country code to save:`,
                    components: [countryRow],
                });

            } else if (customId === 'country_final_select') {
                const selectedCountryCode = i.values[0];
                const selectedCountryName = COUNTRY_MAP.country_data[selectedCountryCode];

                await updateCountrySettings(serverId, selectedCountryCode);

                const finalEmbed = generateCountryComponents(selectedCountryCode, color).embeds[0]
                    .setDescription(`Country setting updated successfully!`);

                await i.editReply({
                    embeds: [finalEmbed],
                    content: `✅ Country set to **${selectedCountryCode}**: ${selectedCountryName}`,
                    components: [],
                });

                collector.stop(); // Stop collecting further interactions
            }
        });

        collector.on('end', (collected, reason) => {
            if (reason === 'time') {
                // Time ran out before the user finished the sequence
                initialMessage.edit({
                    content: 'Timed out. Please run the command again.',
                    components: [],
                }).catch(() => {});
            }
        });
    },
};
